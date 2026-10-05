import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import { AppError, NotFoundError, UnauthorizedError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';
import { env } from '../../config/env';
import { computeEmiStatus, getBusinessDate, EMIStatus } from '@crm/shared';

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
}
