import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError, ValidationError, ConflictError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';
import { env } from '../../config/env';
import {
  computeEmiStatus,
  getBusinessDate,
  EMIStatus,
  CustomerVerificationStatus,
  VerificationSection,
  ICustomerPortalProfile,
  ICustomerCorrectionRequest,
  ICustomerVerification,
  KYCType,
  UserRole,
} from '@crm/shared';
import { getStorageProvider, MAX_KYC_URL_EXPIRY_SECONDS } from '../../core/storage';

const PORTAL_BASE_URL = env?.PORTAL_BASE_URL || process.env.PORTAL_BASE_URL || 'http://localhost:5173/portal';

/**
 * Mask customer phone number for portal privacy.
 * Exposes only the last 4 digits (e.g. "XXXXXX3210").
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return 'XXXX';
  const clean = phone.replace(/\D/g, '');
  if (clean.length >= 4) {
    const last4 = clean.slice(-4);
    return `XXXXXX${last4}`;
  }
  return 'XXXX';
}

/**
 * Format a Date or date string to YYYY-MM-DD without UTC timezone drift.
 */
export function formatDateOnly(d: any): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(d).slice(0, 10);
}

export interface CustomerPortalLoanData {
  customerName: string;
  maskedPhone: string;
  customerPhone: string;
  loanAccountNo: string;
  financedAmount: number;
  emiAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  pendingInstallments: number;
  overdueInstallments: number;
  nextDueDate: string | null;
  outstandingBalance: number;
  totalPaid: number;
  totalPenaltyAmount: number;
  status: string;
  disbursementDate: string;
  maturityDate: string;
  paymentHistory: Array<{
    receiptNumber: string;
    amount: number;
    paymentDate: string;
    paymentMode: string;
    status: string;
  }>;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    expectedAmount: number;
    paidAmount: number;
    remainingAmount: number;
    penaltyAmount: number;
    totalDue: number;
    daysOverdue: number;
    status: string;
  }>;
}

export interface PortalLinkResult {
  token: string;
  portalUrl: string;
  loanId: string;
  customerId: string;
  loanAccountNo: string;
  createdAt: string;
  isActive: boolean;
}

export interface PortalLinkStatus {
  loanId: string;
  loanAccountNo: string;
  hasActiveLink: boolean;
  isActive: boolean;
  createdAt: string | null;
  lastAccessedAt: string | null;
  revokedAt: string | null;
}

export class PortalService {
  /**
   * Generate a cryptographically secure, high-entropy opaque token for a loan portal.
   * Stores ONLY the SHA-256 hash in the database.
   * Plaintext token is returned ONLY in the function return payload for transmission to admin/customer.
   */
  public static async generatePortalLink(
    loanId: string,
    user: AuthenticatedUser,
    options: { regenerate?: boolean } = {}
  ): Promise<PortalLinkResult> {
    // 1. Verify loan exists and is active/valid
    const loanRes = await queryPostgres(
      `SELECT l.id as loan_id, l.customer_id, l.loan_account_no, l.status as loan_status,
              c.id as cust_id, c.full_name, c.deleted_at as customer_deleted_at
       FROM loans l
       JOIN customers c ON c.id = l.customer_id
       WHERE l.id = $1`,
      [loanId]
    );

    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan account not found');
    }

    const row = loanRes.rows[0];

    if (row.customer_deleted_at) {
      throw new AppError('Customer account is inactive or deleted', 400);
    }

    if (row.loan_status === 'CANCELLED' || row.loan_status === 'DRAFT') {
      throw new AppError(`Loans with status ${row.loan_status} are not eligible for customer portal access`, 400);
    }

    // 2. Generate high-entropy opaque token (256 bits random)
    const rawToken = `cpt_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = uuidv4();
    const now = new Date().toISOString();

    // 3. Atomically invalidate previous active tokens and insert new token inside a transaction
    await runPostgresTransaction(async (client) => {
      await client.query(
        `UPDATE customer_portal_tokens
         SET is_active = FALSE, revoked_at = NOW()
         WHERE loan_id = $1 AND is_active = TRUE`,
        [loanId]
      );

      await client.query(
        `INSERT INTO customer_portal_tokens (
          id, loan_id, customer_id, token_hash, is_active, created_at
        ) VALUES ($1, $2, $3, $4, TRUE, NOW())`,
        [tokenId, row.loan_id, row.customer_id, tokenHash]
      );
    });

    // 5. Audit log
    await AuditService.log({
      userId: user.id,
      action: options.regenerate ? 'REGENERATE_PORTAL_TOKEN' : 'GENERATE_PORTAL_TOKEN',
      entity: 'CustomerPortalToken',
      entityId: tokenId,
      newState: {
        loanId: row.loan_id,
        customerId: row.customer_id,
        loanAccountNo: row.loan_account_no,
        tokenId,
      },
    });

    const portalUrl = `${PORTAL_BASE_URL}?token=${rawToken}`;

    return {
      token: rawToken,
      portalUrl,
      loanId: row.loan_id,
      customerId: row.customer_id,
      loanAccountNo: row.loan_account_no,
      createdAt: now,
      isActive: true,
    };
  }

  /**
   * Revoke an active portal link for a loan.
   */
  public static async revokePortalLink(
    loanId: string,
    user: AuthenticatedUser
  ): Promise<{ success: boolean; revokedCount: number }> {
    const loanRes = await queryPostgres('SELECT id, loan_account_no FROM loans WHERE id = $1', [loanId]);
    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan account not found');
    }

    const updateRes = await queryPostgres(
      `UPDATE customer_portal_tokens
       SET is_active = FALSE, revoked_at = NOW()
       WHERE loan_id = $1 AND is_active = TRUE`,
      [loanId]
    );

    const revokedCount = updateRes.rowCount || 0;

    await AuditService.log({
      userId: user.id,
      action: 'REVOKE_PORTAL_TOKEN',
      entity: 'CustomerPortalToken',
      entityId: loanId,
      newState: {
        loanId,
        revokedCount,
      },
    });

    return {
      success: true,
      revokedCount,
    };
  }

  /**
   * Retrieve active portal link status metadata for admin UI.
   * Note: Raw token is never returned here because only the SHA-256 hash is stored in database.
   */
  public static async getActivePortalLinkStatus(loanId: string): Promise<PortalLinkStatus> {
    const loanRes = await queryPostgres(
      `SELECT l.id as loan_id, l.loan_account_no,
              t.id as token_id, t.is_active, t.created_at, t.last_accessed_at, t.revoked_at
       FROM loans l
       LEFT JOIN customer_portal_tokens t ON t.loan_id = l.id AND t.is_active = TRUE
       WHERE l.id = $1
       ORDER BY t.created_at DESC LIMIT 1`,
      [loanId]
    );

    if (loanRes.rows.length === 0) {
      throw new NotFoundError('Loan account not found');
    }

    const row = loanRes.rows[0];
    const hasActive = Boolean(row.token_id && row.is_active);

    return {
      loanId: row.loan_id,
      loanAccountNo: row.loan_account_no,
      hasActiveLink: hasActive,
      isActive: hasActive,
      createdAt: hasActive ? row.created_at : null,
      lastAccessedAt: hasActive ? row.last_accessed_at : null,
      revokedAt: row.revoked_at || null,
    };
  }

  /**
   * Public Customer Portal Data Resolver.
   * Hashes the raw incoming token and fetches strictly scoped customer/loan data.
   * Never accepts customer_id or loan_id as authorization parameters.
   */
  public static async getPortalLoanData(rawToken: string): Promise<CustomerPortalLoanData> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new UnauthorizedError('Portal token is required');
    }

    // 1. Hash the incoming token
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    // 2. Look up token in PostgreSQL
    const tokenRes = await queryPostgres(
      `SELECT t.id as token_id, t.loan_id, t.customer_id, t.is_active, t.revoked_at,
              c.id as cust_id, c.full_name as customer_name, c.primary_phone, c.deleted_at as customer_deleted_at,
              l.id as loan_id, l.loan_account_no, l.principal_amount, l.emi_amount, l.total_installments,
              l.total_paid, l.outstanding_balance, l.status as loan_status, l.disbursement_date, l.maturity_date
       FROM customer_portal_tokens t
       JOIN loans l ON l.id = t.loan_id
       JOIN customers c ON c.id = t.customer_id
       WHERE t.token_hash = $1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      throw new UnauthorizedError('Invalid or expired portal link');
    }

    const row = tokenRes.rows[0];

    // 3. Verify token is active and not revoked
    if (!row.is_active || row.revoked_at) {
      throw new UnauthorizedError('This portal link has been revoked or is no longer active');
    }

    // 4. Verify customer and loan eligibility
    if (row.customer_deleted_at) {
      throw new UnauthorizedError('Customer account is no longer active');
    }

    if (row.loan_status === 'CANCELLED') {
      throw new ForbiddenError('Loan account is cancelled');
    }

    // 5. Update last accessed timestamp asynchronously
    queryPostgres('UPDATE customer_portal_tokens SET last_accessed_at = NOW() WHERE id = $1', [row.token_id]).catch(
      (err) => console.error('[Portal] Failed to update last_accessed_at:', err.message)
    );

    // 6. Fetch installments for schedule and progress breakdown
    const installmentsRes = await queryPostgres(
      `SELECT id, installment_number, due_date, expected_amount, paid_amount, remaining_amount,
              penalty_amount, status, days_overdue
       FROM emi_installments
       WHERE loan_id = $1
       ORDER BY installment_number ASC`,
      [row.loan_id]
    );

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    const mappedInstallments = installmentsRes.rows.map((i) => {
      const expected = Number(i.expected_amount);
      const paid = Number(i.paid_amount);
      const remaining = Number(i.remaining_amount);
      const penalty = Number(i.penalty_amount || 0);
      const totalDue = remaining + penalty;
      const dueDateStr = formatDateOnly(i.due_date);

      const evalResult = computeEmiStatus({
        dueDate: dueDateStr,
        expectedAmount: expected,
        paidAmount: paid,
        remainingAmount: remaining,
        penaltyAmount: penalty,
        businessToday,
      });

      return {
        installmentNumber: Number(i.installment_number),
        dueDate: dueDateStr,
        expectedAmount: expected,
        paidAmount: paid,
        remainingAmount: remaining,
        penaltyAmount: penalty,
        totalDue: Math.max(0, Math.round(totalDue * 100) / 100),
        daysOverdue: evalResult.daysOverdue,
        status: evalResult.status,
        isPaid: evalResult.isPaid,
        isOverdue: evalResult.isOverdue,
      };
    });

    let paidInstallments = 0;
    let overdueInstallments = 0;
    let nextDueDate: string | null = null;

    for (const inst of mappedInstallments) {
      if (inst.isPaid) {
        paidInstallments++;
      } else if (inst.isOverdue) {
        overdueInstallments++;
        if (!nextDueDate) {
          nextDueDate = inst.dueDate;
        }
      } else {
        if (!nextDueDate) {
          nextDueDate = inst.dueDate;
        }
      }
    }

    const totalInstallments = Number(row.total_installments);
    const pendingInstallments = Math.max(0, totalInstallments - paidInstallments);

    // 7. Fetch verified payment history
    const paymentsRes = await queryPostgres(
      `SELECT receipt_number, amount, payment_mode, payment_timestamp, status
       FROM payments
       WHERE loan_id = $1 AND status = 'SUCCESS'
       ORDER BY payment_timestamp DESC`,
      [row.loan_id]
    );

    const totalPenaltyAmount = installmentsRes.rows.reduce(
      (sum, i) => sum + Number(i.penalty_amount || 0),
      0
    );

    // 8. Return strictly sanitized, customer-safe payload
    return {
      customerName: row.customer_name,
      maskedPhone: maskPhoneNumber(row.primary_phone),
      customerPhone: row.primary_phone,
      loanAccountNo: row.loan_account_no,
      financedAmount: Number(row.principal_amount),
      emiAmount: Number(row.emi_amount),
      totalInstallments: Number(row.total_installments),
      paidInstallments,
      pendingInstallments,
      overdueInstallments,
      nextDueDate,
      outstandingBalance: Number(row.outstanding_balance),
      totalPaid: Number(row.total_paid),
      totalPenaltyAmount: Math.round(totalPenaltyAmount * 100) / 100,
      status: row.loan_status,
      disbursementDate: formatDateOnly(row.disbursement_date),
      maturityDate: formatDateOnly(row.maturity_date),
      paymentHistory: paymentsRes.rows.map((p) => ({
        receiptNumber: p.receipt_number,
        amount: Number(p.amount),
        paymentDate:
          p.payment_timestamp instanceof Date
            ? p.payment_timestamp.toISOString()
            : String(p.payment_timestamp),
        paymentMode: p.payment_mode,
        status: p.status,
      })),
      installments: mappedInstallments.map((i) => ({
        installmentNumber: i.installmentNumber,
        dueDate: i.dueDate,
        expectedAmount: i.expectedAmount,
        paidAmount: i.paidAmount,
        remainingAmount: i.remainingAmount,
        penaltyAmount: i.penaltyAmount,
        totalDue: i.totalDue,
        daysOverdue: i.daysOverdue,
        status: i.status,
      })),
    };
  }

  /**
   * Validate opaque portal token and resolve active borrower context.
   */
  public static async validatePortalTokenContext(rawToken: string): Promise<{
    tokenId: string;
    loanId: string;
    customerId: string;
    customerName: string;
    loanAccountNo: string;
  }> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      throw new UnauthorizedError('Portal token is required');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

    const tokenRes = await queryPostgres(
      `SELECT t.id as token_id, t.loan_id, t.customer_id, t.is_active, t.revoked_at,
              c.id as cust_id, c.full_name as customer_name, c.deleted_at as customer_deleted_at,
              l.id as loan_id, l.loan_account_no, l.status as loan_status
       FROM customer_portal_tokens t
       JOIN loans l ON l.id = t.loan_id
       JOIN customers c ON c.id = t.customer_id
       WHERE t.token_hash = $1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      throw new UnauthorizedError('Invalid or expired portal link');
    }

    const row = tokenRes.rows[0];

    if (!row.is_active || row.revoked_at) {
      throw new UnauthorizedError('This portal link has been revoked or is no longer active');
    }

    if (row.customer_deleted_at) {
      throw new UnauthorizedError('Customer account is no longer active');
    }

    if (row.loan_status === 'CANCELLED') {
      throw new ForbiddenError('Loan account is cancelled');
    }

    queryPostgres('UPDATE customer_portal_tokens SET last_accessed_at = NOW() WHERE id = $1', [row.token_id]).catch(() => {});

    return {
      tokenId: row.token_id,
      loanId: row.loan_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      loanAccountNo: row.loan_account_no,
    };
  }

  /**
   * List customer's own KYC documents in Customer Portal.
   * Only returns documents belonging strictly to the validated borrower.
   * Strips all internal storage keys and sensitive metadata.
   */
  public static async getPortalKYCDocuments(rawToken: string) {
    const context = await this.validatePortalTokenContext(rawToken);

    const docsRes = await queryPostgres(
      `SELECT id, customer_id, doc_type, doc_number_masked, status,
              file_mime_type, file_size_bytes, verified_at, created_at
       FROM kyc_documents
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [context.customerId]
    );

    return docsRes.rows.map((doc: any) => ({
      id: doc.id,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      status: doc.status,
      fileMimeType: doc.file_mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      verifiedAt: doc.verified_at,
      createdAt: doc.created_at,
    }));
  }

  /**
   * Generate short-lived presigned download URL for customer's own KYC document in Portal.
   * Validates document ownership against validated portal token.
   */
  public static async getPortalKYCDownloadUrl(rawToken: string, docId: string) {
    const context = await this.validatePortalTokenContext(rawToken);

    const docRes = await queryPostgres(
      `SELECT * FROM kyc_documents WHERE id = $1 AND customer_id = $2`,
      [docId, context.customerId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found or unauthorized');
    }

    const doc = docRes.rows[0];
    if (!doc.storage_key) {
      throw new NotFoundError('KYC document has no storage reference');
    }

    const storage = getStorageProvider();
    let fileExists = false;
    try {
      fileExists = await storage.exists(doc.storage_key);
    } catch (storageErr: any) {
      console.error(`[Portal KYC] Storage provider check failed for doc ${docId}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!fileExists) {
      throw new AppError(
        'Document file not found in storage vault. Please contact support.',
        404,
        'DOCUMENT_FILE_MISSING'
      );
    }

    const downloadUrl = await storage.getSignedUrl({
      key: doc.storage_key,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
      operation: 'getObject',
      mimeType: doc.file_mime_type,
    });

    return {
      documentId: doc.id,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      downloadUrl,
      fileMimeType: doc.file_mime_type,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * Stream customer's own KYC document directly in Portal.
   * Validates ownership and sets strict safe headers.
   */
  public static async streamPortalKYCDocument(rawToken: string, docId: string) {
    const context = await this.validatePortalTokenContext(rawToken);

    const docRes = await queryPostgres(
      `SELECT * FROM kyc_documents WHERE id = $1 AND customer_id = $2`,
      [docId, context.customerId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found or unauthorized');
    }

    const doc = docRes.rows[0];
    if (!doc.storage_key) {
      throw new NotFoundError('KYC document has no storage reference');
    }

    const storage = getStorageProvider();
    let fileExists = false;
    try {
      fileExists = await storage.exists(doc.storage_key);
    } catch (storageErr: any) {
      console.error(`[Portal KYC] Storage provider check failed for doc ${docId}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!fileExists) {
      throw new AppError(
        'Document file not found in storage vault. Please contact support.',
        404,
        'DOCUMENT_FILE_MISSING'
      );
    }

    if (!storage.getStream) {
      throw new AppError('Streaming not supported for active storage provider', 500);
    }

    const streamResult = await storage.getStream(doc.storage_key);

    return {
      stream: streamResult.stream,
      mimeType: doc.file_mime_type || streamResult.contentType || 'application/octet-stream',
      contentLength: streamResult.contentLength,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
    };
  }

  /**
   * Public Customer Portal Profile & KYC Details Resolver.
   * Derives customer identity solely from validated high-entropy portal token context.
   * Never accepts customer_id or loan_id from client.
   * Masks sensitive identifiers and returns strictly scoped customer profile.
   */
  public static async getPortalCustomerProfile(rawToken: string): Promise<ICustomerPortalProfile> {
    const context = await this.validatePortalTokenContext(rawToken);

    // 1. Fetch registered customer details
    const custRes = await queryPostgres(
      `SELECT id, customer_code, full_name, primary_phone, alternate_phone,
              address_line1, address_line2, landmark, city, state, pincode, area_route,
              photo_url
       FROM customers
       WHERE id = $1 AND deleted_at IS NULL`,
      [context.customerId]
    );

    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer account not found');
    }

    const customer = custRes.rows[0];

    // 2. Fetch borrower's own KYC documents (masked)
    const docsRes = await queryPostgres(
      `SELECT id, doc_type, doc_number_masked, status, file_mime_type, file_size_bytes, verified_at, created_at
       FROM kyc_documents
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [context.customerId]
    );

    const photoDoc = docsRes.rows.find((d: any) => d.doc_type === KYCType.PHOTO || d.doc_type === 'PHOTO');
    const hasPhoto = Boolean(photoDoc || (customer.photo_url && String(customer.photo_url).trim().length > 0));

    // 3. Fetch verification record
    const verifRes = await queryPostgres(
      `SELECT id, status, confirmed_at, last_reviewed_at, created_at, updated_at
       FROM customer_kyc_verifications
       WHERE customer_id = $1`,
      [context.customerId]
    );

    const verifRow = verifRes.rows[0];
    const verificationStatus: CustomerVerificationStatus = verifRow
      ? (verifRow.status as CustomerVerificationStatus)
      : CustomerVerificationStatus.NOT_REVIEWED;

    // 4. Fetch correction / issue reports
    const corrRes = await queryPostgres(
      `SELECT cr.id, cr.customer_id, cr.loan_id, cr.request_type, cr.section, cr.explanation,
              cr.status, cr.resolution_notes, cr.reviewed_by, cr.reviewed_at, cr.created_at, cr.updated_at,
              u.full_name as reviewer_name
       FROM customer_kyc_correction_requests cr
       LEFT JOIN users u ON u.id = cr.reviewed_by
       WHERE cr.customer_id = $1
       ORDER BY cr.created_at DESC
       LIMIT 20`,
      [context.customerId]
    );

    const correctionRequests: ICustomerCorrectionRequest[] = corrRes.rows.map((r: any) => ({
      id: r.id,
      customerId: r.customer_id,
      loanId: r.loan_id,
      requestType: r.request_type,
      section: r.section as VerificationSection,
      explanation: r.explanation,
      status: r.status,
      resolutionNotes: r.resolution_notes,
      reviewedBy: r.reviewed_by,
      reviewedByName: r.reviewer_name || null,
      reviewedAt: r.reviewed_at ? (r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : String(r.reviewed_at)) : null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));

    return {
      customerId: customer.id,
      customerCode: customer.customer_code,
      fullName: customer.full_name,
      dob: null, // Explicit null: DOB not captured in current schema
      gender: null, // Explicit null: Gender not captured in current schema
      primaryPhone: maskPhoneNumber(customer.primary_phone),
      alternatePhone: customer.alternate_phone ? maskPhoneNumber(customer.alternate_phone) : null,
      email: null, // Explicit null: Email not captured in current schema
      addressLine1: customer.address_line1,
      addressLine2: customer.address_line2 || null,
      landmark: customer.landmark || null,
      city: customer.city,
      state: customer.state,
      pincode: customer.pincode,
      areaRoute: customer.area_route,
      photoUrl: hasPhoto ? `/api/v1/portal/photo?token=${encodeURIComponent(rawToken.trim())}` : null,
      photoDocId: photoDoc ? photoDoc.id : null,
      hasPhoto,
      loanAccountNo: context.loanAccountNo,
      loanId: context.loanId,
      kycDocuments: docsRes.rows.map((d: any) => ({
        id: d.id,
        docType: d.doc_type,
        docNumberMasked: d.doc_number_masked,
        status: d.status,
        fileMimeType: d.file_mime_type,
        fileSizeBytes: Number(d.file_size_bytes),
        createdAt: d.created_at instanceof Date ? d.created_at.toISOString() : String(d.created_at),
        verifiedAt: d.verified_at ? (d.verified_at instanceof Date ? d.verified_at.toISOString() : String(d.verified_at)) : null,
      })),
      verificationStatus,
      confirmedAt: verifRow?.confirmed_at ? (verifRow.confirmed_at instanceof Date ? verifRow.confirmed_at.toISOString() : String(verifRow.confirmed_at)) : null,
      correctionRequests,
    };
  }

  /**
   * Stream customer's photograph securely.
   * Authenticated solely via validated portal token.
   * Never exposes raw bucket credentials or internal storage paths.
   */
  public static async streamPortalCustomerPhoto(rawToken: string) {
    const context = await this.validatePortalTokenContext(rawToken);

    // 1. Check if customer has a PHOTO KYC document
    const photoDocRes = await queryPostgres(
      `SELECT * FROM kyc_documents
       WHERE customer_id = $1 AND doc_type = $2
       ORDER BY created_at DESC LIMIT 1`,
      [context.customerId, KYCType.PHOTO]
    );

    let storageKey: string | null = null;
    let mimeType = 'image/jpeg';

    if (photoDocRes.rows.length > 0) {
      storageKey = photoDocRes.rows[0].storage_key;
      mimeType = photoDocRes.rows[0].file_mime_type || 'image/jpeg';
    } else {
      // 2. Check customer photo_url column
      const custRes = await queryPostgres(
        `SELECT photo_url FROM customers WHERE id = $1`,
        [context.customerId]
      );
      if (custRes.rows.length > 0 && custRes.rows[0].photo_url) {
        storageKey = custRes.rows[0].photo_url;
      }
    }

    if (!storageKey) {
      throw new NotFoundError('Customer photograph not found');
    }

    const storage = getStorageProvider();
    const fileExists = await storage.exists(storageKey);
    if (!fileExists) {
      throw new NotFoundError('Customer photograph file not found in storage vault');
    }

    if (!storage.getStream) {
      throw new AppError('Streaming not supported for active storage provider', 500);
    }

    const streamResult = await storage.getStream(storageKey);

    return {
      stream: streamResult.stream,
      mimeType: streamResult.contentType || mimeType,
      contentLength: streamResult.contentLength,
    };
  }

  /**
   * Customer Self-Verification Confirmation.
   * Records that borrower reviewed their personal/KYC information and confirmed it is correct.
   * Customer confirmation does NOT alter or approve official regulatory KYC documents.
   */
  public static async confirmPortalProfile(
    rawToken: string,
    section: VerificationSection = VerificationSection.ALL
  ) {
    const context = await this.validatePortalTokenContext(rawToken);

    // Prevent duplicate repeated confirmation within 60 seconds
    const existingVerif = await queryPostgres(
      `SELECT id, status, confirmed_at FROM customer_kyc_verifications WHERE customer_id = $1`,
      [context.customerId]
    );

    if (
      existingVerif.rows.length > 0 &&
      existingVerif.rows[0].status === CustomerVerificationStatus.CONFIRMED &&
      existingVerif.rows[0].confirmed_at
    ) {
      const confirmedTime = new Date(existingVerif.rows[0].confirmed_at).getTime();
      if (Date.now() - confirmedTime < 60_000) {
        return {
          success: true,
          status: CustomerVerificationStatus.CONFIRMED,
          confirmedAt: existingVerif.rows[0].confirmed_at,
          message: 'Details already confirmed recently.',
        };
      }
    }

    const verifId = existingVerif.rows[0]?.id || uuidv4();
    const now = new Date().toISOString();

    // Upsert customer_kyc_verifications
    await queryPostgres(
      `INSERT INTO customer_kyc_verifications (
        id, customer_id, loan_id, status, confirmed_at, updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (customer_id)
      DO UPDATE SET
        status = $4,
        loan_id = COALESCE(customer_kyc_verifications.loan_id, EXCLUDED.loan_id),
        confirmed_at = NOW(),
        updated_at = NOW()`,
      [verifId, context.customerId, context.loanId, CustomerVerificationStatus.CONFIRMED]
    );

    // Record confirmation entry in customer_kyc_correction_requests
    const reqId = uuidv4();
    await queryPostgres(
      `INSERT INTO customer_kyc_correction_requests (
        id, customer_id, loan_id, portal_token_id, request_type, section, explanation, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'CONFIRMATION', $5, 'Customer confirmed details are correct', 'RESOLVED', NOW(), NOW())`,
      [reqId, context.customerId, context.loanId, context.tokenId, section || VerificationSection.ALL]
    );

    // Audit log (actor is the customer, no sensitive KYC payload)
    await AuditService.log({
      userId: null,
      action: 'CUSTOMER_KYC_SELF_CONFIRMED',
      entity: 'CustomerKYCVerification',
      entityId: verifId,
      newState: {
        customerId: context.customerId,
        loanId: context.loanId,
        section: section || VerificationSection.ALL,
        status: CustomerVerificationStatus.CONFIRMED,
        confirmedAt: now,
      },
    });

    return {
      success: true,
      status: CustomerVerificationStatus.CONFIRMED,
      confirmedAt: now,
      message: 'Thank you. Your confirmation has been recorded.',
    };
  }

  /**
   * Report an Issue / Request Correction.
   * Allows borrower to report discrepancies in their personal, contact, address, photograph, or KYC documents.
   * Does NOT directly alter any verified KYC records.
   * Creates a reviewable request for authorized staff.
   */
  public static async reportPortalIssue(
    rawToken: string,
    payload: { section: VerificationSection; explanation: string }
  ) {
    const context = await this.validatePortalTokenContext(rawToken);

    // Validation
    const validSections = Object.values(VerificationSection);
    if (!payload.section || !validSections.includes(payload.section)) {
      throw new ValidationError(`Invalid section. Must be one of: ${validSections.join(', ')}`);
    }

    const trimmedExplanation = (payload.explanation || '').trim();
    if (!trimmedExplanation || trimmedExplanation.length < 5) {
      throw new ValidationError('Please provide a short explanation of the issue (minimum 5 characters).');
    }
    if (trimmedExplanation.length > 1000) {
      throw new ValidationError('Explanation must not exceed 1000 characters.');
    }

    // Prevent duplicate pending issue report for same section in last 2 minutes
    const duplicateCheck = await queryPostgres(
      `SELECT id FROM customer_kyc_correction_requests
       WHERE customer_id = $1 AND section = $2 AND status = 'PENDING'
         AND created_at > NOW() - INTERVAL '2 minutes'`,
      [context.customerId, payload.section]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new AppError(
        'A correction request for this section has recently been submitted and is pending review.',
        409,
        'DUPLICATE_CORRECTION_REQUEST'
      );
    }

    const reqId = uuidv4();
    const verifId = uuidv4();

    // 1. Insert correction request
    await queryPostgres(
      `INSERT INTO customer_kyc_correction_requests (
        id, customer_id, loan_id, portal_token_id, request_type, section, explanation, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'CORRECTION_REQUEST', $5, $6, 'PENDING', NOW(), NOW())`,
      [reqId, context.customerId, context.loanId, context.tokenId, payload.section, trimmedExplanation]
    );

    // 2. Update overall customer verification status
    await queryPostgres(
      `INSERT INTO customer_kyc_verifications (
        id, customer_id, loan_id, status, updated_at
      ) VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (customer_id)
      DO UPDATE SET
        status = $4,
        loan_id = COALESCE(customer_kyc_verifications.loan_id, EXCLUDED.loan_id),
        updated_at = NOW()`,
      [verifId, context.customerId, context.loanId, CustomerVerificationStatus.CORRECTION_REQUESTED]
    );

    // 3. Audit log (never log full raw explanations if they might contain raw PII)
    await AuditService.log({
      userId: null,
      action: 'CUSTOMER_KYC_CORRECTION_REQUESTED',
      entity: 'CustomerKYCCorrectionRequest',
      entityId: reqId,
      newState: {
        customerId: context.customerId,
        loanId: context.loanId,
        section: payload.section,
        explanationLength: trimmedExplanation.length,
        status: 'PENDING',
      },
    });

    return {
      success: true,
      requestId: reqId,
      status: CustomerVerificationStatus.CORRECTION_REQUESTED,
      message: 'Correction request submitted successfully. Our operations team will review your report.',
    };
  }

  /**
   * Staff Endpoint: List correction requests across customers.
   * RBAC: SUPER_ADMIN, ADMIN, BRANCH_MANAGER.
   */
  public static async listCorrectionRequests(
    user: AuthenticatedUser,
    query: { status?: string; section?: string; page?: number; limit?: number }
  ) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const offset = (page - 1) * limit;

    const conditions: string[] = ["cr.request_type = 'CORRECTION_REQUEST'"];
    const params: any[] = [];
    let paramIndex = 1;

    if (query.status) {
      conditions.push(`cr.status = $${paramIndex++}`);
      params.push(query.status);
    }

    if (query.section) {
      conditions.push(`cr.section = $${paramIndex++}`);
      params.push(query.section);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await queryPostgres(
      `SELECT COUNT(*) as total FROM customer_kyc_correction_requests cr ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.total || 0);

    const listParams = [...params, limit, offset];
    const listRes = await queryPostgres(
      `SELECT cr.id, cr.customer_id, cr.loan_id, cr.request_type, cr.section, cr.explanation,
              cr.status, cr.resolution_notes, cr.reviewed_by, cr.reviewed_at, cr.created_at, cr.updated_at,
              c.full_name as customer_name, c.customer_code, c.primary_phone,
              l.loan_account_no,
              u.full_name as reviewer_name
       FROM customer_kyc_correction_requests cr
       JOIN customers c ON c.id = cr.customer_id
       LEFT JOIN loans l ON l.id = cr.loan_id
       LEFT JOIN users u ON u.id = cr.reviewed_by
       ${whereClause}
       ORDER BY cr.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      listParams
    );

    return {
      requests: listRes.rows.map((r: any) => ({
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerCode: r.customer_code,
        customerPhone: maskPhoneNumber(r.primary_phone),
        loanId: r.loan_id,
        loanAccountNo: r.loan_account_no,
        requestType: r.request_type,
        section: r.section,
        explanation: r.explanation,
        status: r.status,
        resolutionNotes: r.resolution_notes,
        reviewedBy: r.reviewed_by,
        reviewedByName: r.reviewer_name,
        reviewedAt: r.reviewed_at ? (r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : String(r.reviewed_at)) : null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Staff Endpoint: Get customer's verification and correction history.
   * RBAC: SUPER_ADMIN, ADMIN, BRANCH_MANAGER, COLLECTION_AGENT.
   */
  public static async getCustomerVerifications(customerId: string, user: AuthenticatedUser) {
    const custRes = await queryPostgres(
      `SELECT id, customer_code, full_name FROM customers WHERE id = $1 AND deleted_at IS NULL`,
      [customerId]
    );

    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const verifRes = await queryPostgres(
      `SELECT * FROM customer_kyc_verifications WHERE customer_id = $1`,
      [customerId]
    );

    const corrRes = await queryPostgres(
      `SELECT cr.*, u.full_name as reviewer_name, l.loan_account_no
       FROM customer_kyc_correction_requests cr
       LEFT JOIN users u ON u.id = cr.reviewed_by
       LEFT JOIN loans l ON l.id = cr.loan_id
       WHERE cr.customer_id = $1
       ORDER BY cr.created_at DESC`,
      [customerId]
    );

    return {
      customer: custRes.rows[0],
      verification: verifRes.rows[0]
        ? {
            id: verifRes.rows[0].id,
            customerId: verifRes.rows[0].customer_id,
            loanId: verifRes.rows[0].loan_id,
            status: verifRes.rows[0].status,
            confirmedAt: verifRes.rows[0].confirmed_at
              ? (verifRes.rows[0].confirmed_at instanceof Date ? verifRes.rows[0].confirmed_at.toISOString() : String(verifRes.rows[0].confirmed_at))
              : null,
            lastReviewedAt: verifRes.rows[0].last_reviewed_at
              ? (verifRes.rows[0].last_reviewed_at instanceof Date ? verifRes.rows[0].last_reviewed_at.toISOString() : String(verifRes.rows[0].last_reviewed_at))
              : null,
            createdAt: verifRes.rows[0].created_at instanceof Date ? verifRes.rows[0].created_at.toISOString() : String(verifRes.rows[0].created_at),
            updatedAt: verifRes.rows[0].updated_at instanceof Date ? verifRes.rows[0].updated_at.toISOString() : String(verifRes.rows[0].updated_at),
          }
        : {
            id: '',
            customerId,
            loanId: null,
            status: CustomerVerificationStatus.NOT_REVIEWED,
            confirmedAt: null,
            lastReviewedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
      requests: corrRes.rows.map((r: any) => ({
        id: r.id,
        customerId: r.customer_id,
        loanId: r.loan_id,
        loanAccountNo: r.loan_account_no,
        requestType: r.request_type,
        section: r.section,
        explanation: r.explanation,
        status: r.status,
        resolutionNotes: r.resolution_notes,
        reviewedBy: r.reviewed_by,
        reviewedByName: r.reviewer_name,
        reviewedAt: r.reviewed_at ? (r.reviewed_at instanceof Date ? r.reviewed_at.toISOString() : String(r.reviewed_at)) : null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      })),
    };
  }

  /**
   * Staff Endpoint: Review a customer correction request.
   * RBAC: SUPER_ADMIN, ADMIN, BRANCH_MANAGER.
   */
  public static async reviewCorrectionRequest(
    requestId: string,
    user: AuthenticatedUser,
    body: { status: 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED'; resolutionNotes?: string }
  ) {
    const allowedStatuses = ['UNDER_REVIEW', 'RESOLVED', 'REJECTED'];
    if (!body.status || !allowedStatuses.includes(body.status)) {
      throw new ValidationError(`Status must be one of: ${allowedStatuses.join(', ')}`);
    }

    const reqRes = await queryPostgres(
      `SELECT * FROM customer_kyc_correction_requests WHERE id = $1`,
      [requestId]
    );

    if (reqRes.rows.length === 0) {
      throw new NotFoundError('Correction request not found');
    }

    const currentReq = reqRes.rows[0];

    // Update the request
    await queryPostgres(
      `UPDATE customer_kyc_correction_requests
       SET status = $1, resolution_notes = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [body.status, body.resolutionNotes || null, user.id, requestId]
    );

    // Re-evaluate customer-level verification status
    const pendingCountRes = await queryPostgres(
      `SELECT COUNT(*) as pending_count FROM customer_kyc_correction_requests
       WHERE customer_id = $1 AND status = 'PENDING' AND id != $2`,
      [currentReq.customer_id, requestId]
    );
    const pendingCount = Number(pendingCountRes.rows[0]?.pending_count || 0);

    let newCustomerVerifStatus: CustomerVerificationStatus;
    if (pendingCount > 0) {
      newCustomerVerifStatus = CustomerVerificationStatus.CORRECTION_REQUESTED;
    } else if (body.status === 'UNDER_REVIEW') {
      newCustomerVerifStatus = CustomerVerificationStatus.UNDER_REVIEW;
    } else if (body.status === 'RESOLVED') {
      newCustomerVerifStatus = CustomerVerificationStatus.RESOLVED;
    } else {
      newCustomerVerifStatus = CustomerVerificationStatus.REJECTED;
    }

    await queryPostgres(
      `UPDATE customer_kyc_verifications
       SET status = $1, last_reviewed_at = NOW(), updated_at = NOW()
       WHERE customer_id = $2`,
      [newCustomerVerifStatus, currentReq.customer_id]
    );

    // Audit log
    await AuditService.log({
      userId: user.id,
      action: 'REVIEW_CUSTOMER_KYC_CORRECTION',
      entity: 'CustomerKYCCorrectionRequest',
      entityId: requestId,
      previousState: {
        status: currentReq.status,
      },
      newState: {
        status: body.status,
        resolutionNotes: body.resolutionNotes || null,
        reviewedBy: user.id,
        customerVerificationStatus: newCustomerVerifStatus,
      },
    });

    return {
      success: true,
      requestId,
      status: body.status,
      customerVerificationStatus: newCustomerVerifStatus,
      message: `Correction request marked as ${body.status}`,
    };
  }
}
