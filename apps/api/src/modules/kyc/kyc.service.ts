import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { queryPostgres } from '../../database/postgres';
import { KYCType, KYCStatus, UserRole, maskAadhaar, maskPan } from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError, UnauthorizedError, ValidationError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { getStorageProvider, MAX_KYC_URL_EXPIRY_SECONDS } from '../../core/storage';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Validates magic bytes / binary file header signatures against declared MIME type
 * to prevent disguised or malicious executable/script file uploads.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 3) return false;
  const normMime = mimeType.toLowerCase().trim();
  if (normMime === 'application/pdf') {
    return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }
  if (normMime === 'image/jpeg' || normMime === 'image/jpg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (normMime === 'image/png') {
    return buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  }
  if (normMime === 'image/webp') {
    return buffer.length >= 4 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  }
  return true;
}

export class KYCService {
  /**
   * Generate secure short-lived pre-signed upload URL (Clamped to <= 300s).
   */
  public static async generatePresignedUploadUrl(
    customerId: string,
    docType: KYCType,
    fileName: string,
    mimeType: string,
    fileSizeBytes: number,
    user: AuthenticatedUser
  ) {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new ValidationError(`Invalid file type ${mimeType}. Only JPEG, PNG, WEBP, or PDF are permitted.`);
    }

    // Validate File Size
    if (fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
      throw new ValidationError('File size must be greater than 0 and less than or equal to 10 MB.');
    }

    // Validate Customer existence
    const custRes = await queryPostgres(
      'SELECT id, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    // RLAC: Agents can only upload KYC for assigned customers
    if (user.role === UserRole.COLLECTION_AGENT) {
      const assignmentRes = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = $3)
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
        [user.id, customer.id, customer.area_route]
      );
      if (assignmentRes.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to upload KYC documents for this customer');
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      const dealerAccess = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND (created_by = $3 OR created_by IN (SELECT id FROM users WHERE dealer_id = $1))`,
        [user.dealerId, customer.id, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to upload KYC documents for this customer');
      }
    }

    const rawExt = fileName.split('.').pop()?.toLowerCase() || 'bin';
    const fileExt = rawExt.replace(/[^a-z0-9]/g, '') || 'bin';
    const storageKey = `kyc/${customerId}/${uuidv4()}.${fileExt}`;

    const storage = getStorageProvider();
    let uploadUrl: string;
    try {
      uploadUrl = await storage.getSignedUrl({
        key: storageKey,
        expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
        operation: 'putObject',
        mimeType,
      });
    } catch (storageErr: any) {
      console.error(`[KYC Presigned Upload Storage Error] Storage getSignedUrl failed for key ${storageKey}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    return {
      uploadUrl,
      storageKey,
      fileMimeType: mimeType,
      fileSizeBytes,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * Confirm document upload and store metadata with automatic masking & hashing.
   */
  public static async confirmKYCDocument(
    data: {
      customerId: string;
      docType: KYCType;
      docNumber?: string | null;
      storageKey: string;
      fileMimeType: string;
      fileSizeBytes: number;
    },
    user: AuthenticatedUser
  ) {
    const custRes = await queryPostgres(
      'SELECT id, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [data.customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    // Storage key path validation to prevent linking files from other customers
    if (!data.storageKey.startsWith(`kyc/${data.customerId}/`)) {
      throw new ValidationError('Invalid storage key: document must be uploaded to the customer directory');
    }

    // RLAC check for agents and dealers
    if (user.role === UserRole.COLLECTION_AGENT) {
      const assignmentRes = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = $3)
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
        [user.id, customer.id, customer.area_route]
      );
      if (assignmentRes.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to confirm KYC documents for this customer');
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      const dealerAccess = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND (created_by = $3 OR created_by IN (SELECT id FROM users WHERE dealer_id = $1))`,
        [user.dealerId, data.customerId, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to confirm KYC documents for this customer');
      }
    }

    const storage = getStorageProvider();
    let fileExists = false;
    try {
      fileExists = await storage.exists(data.storageKey);
    } catch (storageErr: any) {
      console.error(`[KYC Confirm Storage Error] Storage check failed for key ${data.storageKey}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry confirmation shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!fileExists) {
      throw new ValidationError('Uploaded document file not found in storage vault. Please ensure file upload completed successfully before confirming.');
    }

    const docId = uuidv4();
    let maskedNumber: string | null = null;
    let numberHash: string | null = null;

    if (data.docNumber) {
      const raw = data.docNumber.trim();
      if (data.docType === KYCType.AADHAAR) {
        maskedNumber = maskAadhaar(raw);
      } else if (data.docType === KYCType.PAN) {
        maskedNumber = maskPan(raw);
      } else {
        maskedNumber = raw.length > 6 ? `${raw.slice(0, 3)}****${raw.slice(-3)}` : '******';
      }

      numberHash = crypto.createHash('sha256').update(raw.toUpperCase()).digest('hex');
    }

    const sql = `
      INSERT INTO kyc_documents (
        id, customer_id, doc_type, doc_number_masked, doc_number_hash,
        storage_key, file_mime_type, file_size_bytes, status, verified_by,
        verified_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VERIFIED', $9, NOW(), NOW())
      RETURNING *
    `;

    const result = await queryPostgres(sql, [
      docId,
      data.customerId,
      data.docType,
      maskedNumber,
      numberHash,
      data.storageKey,
      data.fileMimeType,
      data.fileSizeBytes,
      user.id,
    ]);

    const created = result.rows[0];

    await AuditService.log({
      userId: user.id,
      action: 'KYC_DOCUMENT_UPLOADED',
      entity: 'KYCDocument',
      entityId: docId,
      newState: { customerId: data.customerId, docType: data.docType, maskedNumber },
    });

    return {
      id: created.id,
      customerId: created.customer_id,
      docType: created.doc_type,
      docNumberMasked: created.doc_number_masked,
      status: created.status as KYCStatus,
      createdAt: created.created_at,
    };
  }

  /**
   * Direct authenticated upload through API server.
   * Eliminates browser CORS issues with private buckets while enforcing full RLAC,
   * validation, hashing, storage, and audit logging.
   */
  public static async directUploadKYCDocument(
    data: {
      customerId: string;
      docType: KYCType;
      docNumber?: string | null;
      fileName: string;
      mimeType: string;
      fileBuffer: Buffer;
    },
    user: AuthenticatedUser
  ) {
    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      throw new ValidationError(`Invalid file type ${data.mimeType}. Only JPEG, PNG, WEBP, or PDF are permitted.`);
    }

    const fileSizeBytes = data.fileBuffer.length;
    if (fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE) {
      throw new ValidationError('File size must be greater than 0 and less than or equal to 10 MB.');
    }

    // Binary file signature / magic bytes validation
    if (!validateMagicBytes(data.fileBuffer, data.mimeType)) {
      throw new ValidationError('File content does not match the declared MIME type.');
    }

    const custRes = await queryPostgres(
      'SELECT id, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [data.customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    // RLAC: Agents can only upload for assigned customers
    if (user.role === UserRole.COLLECTION_AGENT) {
      const assignmentRes = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = $3)
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
        [user.id, customer.id, customer.area_route]
      );
      if (assignmentRes.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to upload KYC documents for this customer');
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      const dealerAccess = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND (created_by = $3 OR created_by IN (SELECT id FROM users WHERE dealer_id = $1))`,
        [user.dealerId, customer.id, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to upload KYC documents for this customer');
      }
    }

    const rawExt = data.fileName.split('.').pop()?.toLowerCase() || 'bin';
    const fileExt = rawExt.replace(/[^a-z0-9]/g, '') || 'bin';
    const storageKey = `kyc/${data.customerId}/${uuidv4()}.${fileExt}`;

    const storage = getStorageProvider();
    try {
      await storage.upload({
        key: storageKey,
        body: data.fileBuffer,
        mimeType: data.mimeType,
        isPrivate: true,
      });
    } catch (storageErr: any) {
      console.error(`[KYC Direct Upload Storage Error] Upload failed for key ${storageKey}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry upload shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    const docId = uuidv4();
    let maskedNumber: string | null = null;
    let numberHash: string | null = null;

    if (data.docNumber) {
      const raw = data.docNumber.trim();
      if (data.docType === KYCType.AADHAAR) {
        maskedNumber = maskAadhaar(raw);
      } else if (data.docType === KYCType.PAN) {
        maskedNumber = maskPan(raw);
      } else {
        maskedNumber = raw.length > 6 ? `${raw.slice(0, 3)}****${raw.slice(-3)}` : '******';
      }

      numberHash = crypto.createHash('sha256').update(raw.toUpperCase()).digest('hex');
    }

    const sql = `
      INSERT INTO kyc_documents (
        id, customer_id, doc_type, doc_number_masked, doc_number_hash,
        storage_key, file_mime_type, file_size_bytes, status, verified_by,
        verified_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VERIFIED', $9, NOW(), NOW())
      RETURNING *
    `;

    try {
      const result = await queryPostgres(sql, [
        docId,
        data.customerId,
        data.docType,
        maskedNumber,
        numberHash,
        storageKey,
        data.mimeType,
        fileSizeBytes,
        user.id,
      ]);

      const created = result.rows[0];

      await AuditService.log({
        userId: user.id,
        action: 'KYC_DOCUMENT_UPLOADED',
        entity: 'KYCDocument',
        entityId: docId,
        newState: { customerId: data.customerId, docType: data.docType, maskedNumber },
      });

      return {
        id: created.id,
        customerId: created.customer_id,
        docType: created.doc_type,
        docNumberMasked: created.doc_number_masked,
        status: created.status as KYCStatus,
        createdAt: created.created_at,
      };
    } catch (dbErr: any) {
      console.error(`[KYC Direct Upload DB Error] Database insert failed for docId ${docId}, cleaning up storage file:`, dbErr?.message || dbErr);
      try {
        await storage.delete(storageKey);
      } catch (cleanupErr: any) {
        console.error(`[KYC Direct Upload Cleanup Error] Failed to delete orphaned key ${storageKey}:`, cleanupErr?.message || cleanupErr);
      }
      throw dbErr;
    }
  }

  /**
   * Centralized document access verification enforcing RBAC, dealer store ownership,
   * collection agent assignment, and branch manager isolation.
   */
  public static async verifyDocumentAccess(docId: string, user: AuthenticatedUser) {
    if (!docId) {
      throw new NotFoundError('KYC document not found');
    }

    const docRes = await queryPostgres(
      `SELECT d.*, c.created_by AS customer_created_by, c.area_route AS customer_area_route
       FROM kyc_documents d
       JOIN customers c ON d.customer_id = c.id
       WHERE d.id = $1 AND c.deleted_at IS NULL`,
      [docId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found');
    }

    const doc = docRes.rows[0];

    // Ensure the authenticated user exists and is active in the database
    const userRes = await queryPostgres(
      'SELECT id, status, deleted_at FROM users WHERE id = $1',
      [user.id]
    );
    const dbUser = userRes.rows[0];
    if (!dbUser || dbUser.deleted_at || dbUser.status !== 'ACTIVE') {
      throw new UnauthorizedError('User account is inactive, deleted, or no longer exists');
    }

    // Super Admin and Admin have global cross-organization access
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN) {
      return doc;
    }

    // Branch Manager access control: verify branch scoping if branch is assigned
    if (user.role === UserRole.BRANCH_MANAGER) {
      if (user.assignedBranch) {
        const branchRes = await queryPostgres(
          `SELECT DISTINCT u.assigned_branch
           FROM (
             SELECT created_by AS user_id FROM customers WHERE id = $1 AND deleted_at IS NULL
             UNION
             SELECT created_by AS user_id FROM loans WHERE customer_id = $1
             UNION
             SELECT assigned_agent_id AS user_id FROM loans WHERE customer_id = $1 AND assigned_agent_id IS NOT NULL
           ) affiliations
           JOIN users u ON affiliations.user_id = u.id
           WHERE u.assigned_branch IS NOT NULL`,
          [doc.customer_id]
        );

        const affiliatedBranches = branchRes.rows.map((r: any) => r.assigned_branch);
        if (affiliatedBranches.length > 0 && !affiliatedBranches.includes(user.assignedBranch)) {
          throw new ForbiddenError('You are not authorized to access KYC documents outside your assigned branch');
        }
      }
      return doc;
    }

    // Dealer access control: strictly verify dealer ownership of customer / loan
    if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }

      const dealerAccess = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND (created_by = $3 OR created_by IN (SELECT id FROM users WHERE dealer_id = $1))`,
        [user.dealerId, doc.customer_id, user.id]
      );

      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to access KYC documents for this customer');
      }
      return doc;
    }

    // Collection Agent access control: strictly verify assigned customer / loan
    if (user.role === UserRole.COLLECTION_AGENT) {
      const agentAccess = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = (SELECT area_route FROM customers WHERE id = $2))
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         UNION
         SELECT id FROM loans
         WHERE assigned_agent_id = $1 AND customer_id = $2`,
        [user.id, doc.customer_id]
      );

      if (agentAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to view KYC documents for this unassigned customer');
      }
      return doc;
    }

    throw new ForbiddenError('You do not have permission to view this KYC document');
  }

  /**
   * Generate short-lived (max 300s) pre-signed download URL.
   * Allowed for Super Admin, Admin, Branch Manager, Dealer (for own customer/loans),
   * and Collection Agent (for assigned customer/loans).
   */
  public static async generatePresignedDownloadUrl(docId: string, user: AuthenticatedUser) {
    const doc = await this.verifyDocumentAccess(docId, user);

    if (!doc.storage_key) {
      throw new NotFoundError('KYC document has no storage reference');
    }

    const storage = getStorageProvider();
    let fileExists = false;
    try {
      fileExists = await storage.exists(doc.storage_key);
    } catch (storageErr: any) {
      console.error(`[KYC Storage Error] Storage provider check failed for doc ${docId}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!fileExists) {
      const correlationId = `kyc_miss_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      console.error(`[KYC Diagnostic] Storage object missing: docId=${docId}, customerId=${doc.customer_id}, docType=${doc.doc_type}, key=${doc.storage_key}, correlationId=${correlationId}`);

      await AuditService.log({
        userId: user.id,
        action: 'KYC_STORAGE_OBJECT_MISSING',
        entity: 'KYCDocument',
        entityId: docId,
        newState: {
          customerId: doc.customer_id,
          docType: doc.doc_type,
          correlationId,
          reason: 'Underlying file missing from storage vault'
        }
      });

      throw new AppError(
        `Document file not found in storage vault. An authorized administrator can safely re-upload the document from the customer profile. (Ref: ${correlationId})`,
        404,
        'DOCUMENT_FILE_MISSING'
      );
    }

    let downloadUrl: string;
    try {
      downloadUrl = await storage.getSignedUrl({
        key: doc.storage_key,
        expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
        operation: 'getObject',
        mimeType: doc.file_mime_type,
      });
    } catch (storageErr: any) {
      console.error(`[KYC Download Error] Failed to generate signed URL for key ${doc.storage_key}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    await AuditService.log({
      userId: user.id,
      action: 'KYC_SENSITIVE_VIEWED',
      entity: 'KYCDocument',
      entityId: docId,
      newState: { customerId: doc.customer_id, docType: doc.doc_type },
    });

    return {
      documentId: doc.id,
      customerId: doc.customer_id,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      downloadUrl,
      fileMimeType: doc.file_mime_type,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * Authenticated direct streaming for KYC document view or download.
   */
  public static async streamKYCDocument(docId: string, user: AuthenticatedUser) {
    const doc = await this.verifyDocumentAccess(docId, user);

    if (!doc.storage_key) {
      throw new NotFoundError('KYC document has no storage reference');
    }

    const storage = getStorageProvider();
    let fileExists = false;
    try {
      fileExists = await storage.exists(doc.storage_key);
    } catch (storageErr: any) {
      console.error(`[KYC Storage Error] Storage provider check failed for doc ${docId}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!fileExists) {
      const correlationId = `kyc_miss_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      console.error(`[KYC Diagnostic] Storage object missing: docId=${docId}, customerId=${doc.customer_id}, docType=${doc.doc_type}, key=${doc.storage_key}, correlationId=${correlationId}`);

      await AuditService.log({
        userId: user.id,
        action: 'KYC_STORAGE_OBJECT_MISSING',
        entity: 'KYCDocument',
        entityId: docId,
        newState: {
          customerId: doc.customer_id,
          docType: doc.doc_type,
          correlationId,
          reason: 'Underlying file missing from storage vault'
        }
      });

      throw new AppError(
        `Document file not found in storage vault. An authorized administrator can safely re-upload the document from the customer profile. (Ref: ${correlationId})`,
        404,
        'DOCUMENT_FILE_MISSING'
      );
    }

    if (!storage.getStream) {
      throw new AppError('Streaming not supported for active storage provider', 500);
    }

    let streamResult: any;
    try {
      streamResult = await storage.getStream(doc.storage_key);
    } catch (storageErr: any) {
      console.error(`[KYC Stream Error] Failed to get stream for key ${doc.storage_key}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    await AuditService.log({
      userId: user.id,
      action: 'KYC_SENSITIVE_VIEWED',
      entity: 'KYCDocument',
      entityId: docId,
      newState: { customerId: doc.customer_id, docType: doc.doc_type, stream: true },
    });

    return {
      stream: streamResult.stream,
      mimeType: doc.file_mime_type || streamResult.contentType || 'application/octet-stream',
      contentLength: streamResult.contentLength,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      storageKey: doc.storage_key,
    };
  }

  /**
   * List KYC documents for customer with PII masking and agent/dealer storage_key stripping.
   */
  public static async getKYCDocumentsForCustomer(customerId: string, user: AuthenticatedUser) {
    const custRes = await queryPostgres(
      'SELECT id, area_route FROM customers WHERE id = $1 AND deleted_at IS NULL',
      [customerId]
    );
    if (custRes.rows.length === 0) {
      throw new NotFoundError('Customer not found');
    }

    const customer = custRes.rows[0];

    if (user.role === UserRole.COLLECTION_AGENT) {
      const assignmentRes = await queryPostgres(
        `SELECT id FROM collection_assignments
         WHERE agent_id = $1 AND (customer_id = $2 OR area_route = $3)
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         UNION
         SELECT id FROM loans
         WHERE assigned_agent_id = $1 AND customer_id = $2`,
        [user.id, customer.id, customer.area_route]
      );
      if (assignmentRes.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to view KYC documents for this customer');
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) {
        throw new ForbiddenError('Dealer context missing');
      }
      const dealerAccess = await queryPostgres(
        `SELECT id FROM loans WHERE dealer_id = $1 AND customer_id = $2
         UNION
         SELECT id FROM customers WHERE id = $2 AND created_by = $3`,
        [user.dealerId, customer.id, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to view KYC documents for this customer');
      }
    }

    const docsRes = await queryPostgres(
      'SELECT * FROM kyc_documents WHERE customer_id = $1 ORDER BY created_at DESC',
      [customerId]
    );

    const hideKey = user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER;

    return docsRes.rows.map((doc: any) => ({
      id: doc.id,
      customerId: doc.customer_id,
      docType: doc.doc_type,
      docNumberMasked: doc.doc_number_masked,
      status: doc.status,
      storageKey: hideKey ? undefined : doc.storage_key, // Strip raw key for agents and dealers
      fileMimeType: doc.file_mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      verifiedAt: doc.verified_at,
      createdAt: doc.created_at,
    }));
  }

  /**
   * Initialize safe replacement / re-upload of a missing or updated KYC document.
   * Allowed for Super Admin, Admin, and Branch Manager.
   */
  public static async initReuploadKYCDocument(
    docId: string,
    data: { fileName: string; mimeType: string; fileSizeBytes: number },
    user: AuthenticatedUser
  ) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.BRANCH_MANAGER
    ) {
      throw new ForbiddenError('Only administrators and branch managers can replace KYC documents');
    }

    if (!ALLOWED_MIME_TYPES.includes(data.mimeType)) {
      throw new ValidationError(`Invalid file type ${data.mimeType}. Only JPEG, PNG, WEBP, or PDF are permitted.`);
    }

    if (data.fileSizeBytes <= 0 || data.fileSizeBytes > MAX_FILE_SIZE) {
      throw new ValidationError('File size must be greater than 0 and less than or equal to 10 MB.');
    }

    const docRes = await queryPostgres('SELECT * FROM kyc_documents WHERE id = $1', [docId]);
    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found');
    }
    const doc = docRes.rows[0];

    const rawExt = data.fileName.split('.').pop()?.toLowerCase() || 'bin';
    const fileExt = rawExt.replace(/[^a-z0-9]/g, '') || 'bin';
    const newStorageKey = `kyc/${doc.customer_id}/${uuidv4()}.${fileExt}`;

    const storage = getStorageProvider();
    let uploadUrl: string;
    try {
      uploadUrl = await storage.getSignedUrl({
        key: newStorageKey,
        expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
        operation: 'putObject',
        mimeType: data.mimeType,
      });
    } catch (storageErr: any) {
      console.error(`[KYC Reupload Storage Error] getSignedUrl failed for key ${newStorageKey}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    return {
      uploadUrl,
      storageKey: newStorageKey,
      fileMimeType: data.mimeType,
      fileSizeBytes: data.fileSizeBytes,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * Confirm replacement / re-upload of a KYC document.
   * Updates database record ONLY after ensuring new object is present in storage.
   * Cleans up old storage object only AFTER database update succeeds.
   */
  public static async confirmReplacementKYCDocument(
    docId: string,
    data: { storageKey: string; fileMimeType: string; fileSizeBytes: number; docNumber?: string | null },
    user: AuthenticatedUser
  ) {
    if (
      user.role !== UserRole.SUPER_ADMIN &&
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.BRANCH_MANAGER
    ) {
      throw new ForbiddenError('Only administrators and branch managers can replace KYC documents');
    }

    const docRes = await queryPostgres('SELECT * FROM kyc_documents WHERE id = $1', [docId]);
    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found');
    }
    const doc = docRes.rows[0];

    if (!data.storageKey.startsWith(`kyc/${doc.customer_id}/`)) {
      throw new ValidationError('Invalid storage key: document must be uploaded to the customer directory');
    }

    const storage = getStorageProvider();
    let newFileExists = false;
    try {
      newFileExists = await storage.exists(data.storageKey);
    } catch (storageErr: any) {
      console.error(`[KYC Replacement Confirm Error] storage.exists failed for key ${data.storageKey}:`, storageErr?.message || storageErr);
      throw new AppError('Storage service temporarily unavailable. Please retry shortly.', 503, 'STORAGE_PROVIDER_ERROR');
    }

    if (!newFileExists) {
      throw new ValidationError('Uploaded replacement file was not found in storage. Ensure file upload completed before confirming.');
    }

    const oldStorageKey = doc.storage_key;

    let maskedNumber = doc.doc_number_masked;
    let numberHash = doc.doc_number_hash;
    if (data.docNumber && data.docNumber.trim()) {
      const raw = data.docNumber.trim();
      if (doc.doc_type === KYCType.AADHAAR) {
        maskedNumber = maskAadhaar(raw);
      } else if (doc.doc_type === KYCType.PAN) {
        maskedNumber = maskPan(raw);
      } else {
        maskedNumber = raw.length > 4 ? `XXXX${raw.slice(-4)}` : raw;
      }
      numberHash = crypto.createHash('sha256').update(raw.toUpperCase()).digest('hex');
    }

    const updateRes = await queryPostgres(
      `UPDATE kyc_documents
       SET storage_key = $1, file_mime_type = $2, file_size_bytes = $3,
           doc_number_masked = $4, doc_number_hash = $5, status = 'VERIFIED',
           verified_by = $6, verified_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [data.storageKey, data.fileMimeType, data.fileSizeBytes, maskedNumber, numberHash, user.id, docId]
    );

    const updated = updateRes.rows[0];

    if (oldStorageKey && oldStorageKey !== data.storageKey) {
      try {
        await storage.delete(oldStorageKey);
      } catch (cleanErr) {
        console.warn('[KYC Re-upload] Non-fatal cleanup warning for old key:', cleanErr);
      }
    }

    await AuditService.log({
      userId: user.id,
      action: 'KYC_DOCUMENT_REPLACED',
      entity: 'KYCDocument',
      entityId: docId,
      newState: { customerId: doc.customer_id, docType: doc.doc_type, newStorageKey: data.storageKey },
      previousState: { oldStorageKey },
    });

    return {
      id: updated.id,
      customerId: updated.customer_id,
      docType: updated.doc_type,
      docNumberMasked: updated.doc_number_masked,
      status: updated.status,
      fileMimeType: updated.file_mime_type,
      fileSizeBytes: Number(updated.file_size_bytes),
      verifiedAt: updated.verified_at,
      createdAt: updated.created_at,
    };
  }

  /**
   * Delete / remove a KYC document (Admin / Branch Manager only).
   * Safely deletes the corresponding storage object before removing the database record.
   */
  public static async deleteKYCDocument(docId: string, user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER) {
      throw new ForbiddenError('You are not authorized to delete KYC documents');
    }

    const docRes = await queryPostgres(
      'SELECT * FROM kyc_documents WHERE id = $1',
      [docId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found');
    }

    const doc = docRes.rows[0];

    // Safely delete object from configured storage provider abstraction
    if (doc.storage_key) {
      const storage = getStorageProvider();
      try {
        await storage.delete(doc.storage_key);
      } catch (storageErr: any) {
        // Safe if already missing / idempotently deleted
        const isAlreadyMissing =
          storageErr?.code === 'ENOENT' ||
          storageErr?.name === 'NoSuchKey' ||
          storageErr?.code === 'NoSuchKey' ||
          storageErr?.$metadata?.httpStatusCode === 404;

        if (!isAlreadyMissing) {
          console.error('[KYC Delete] Storage object deletion failed:', storageErr?.message || storageErr);
          throw new AppError(
            'Unable to delete the stored document file. The document record was not removed.',
            500,
            'STORAGE_DELETION_FAILED'
          );
        }
      }
    }

    await queryPostgres('DELETE FROM kyc_documents WHERE id = $1', [docId]);

    await AuditService.log({
      userId: user.id,
      action: 'KYC_DOCUMENT_DELETED',
      entity: 'KYCDocument',
      entityId: docId,
      previousState: { customerId: doc.customer_id, docType: doc.doc_type, docNumberMasked: doc.doc_number_masked },
    });

    return {
      success: true,
      message: 'KYC document deleted successfully',
    };
  }
}

