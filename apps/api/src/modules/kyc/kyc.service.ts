import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { queryPostgres } from '../../database/postgres';
import { KYCType, KYCStatus, UserRole, maskAadhaar, maskPan } from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { getStorageProvider, MAX_KYC_URL_EXPIRY_SECONDS } from '../../core/storage';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
         SELECT id FROM customers WHERE id = $2 AND created_by = $3`,
        [user.dealerId, customer.id, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to upload KYC documents for this customer');
      }
    }

    const fileExt = fileName.split('.').pop()?.toLowerCase() || 'bin';
    const storageKey = `kyc/${customerId}/${uuidv4()}.${fileExt}`;

    const storage = getStorageProvider();
    const uploadUrl = await storage.getSignedUrl({
      key: storageKey,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
      operation: 'putObject',
      mimeType,
    });

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
         SELECT id FROM customers WHERE id = $2 AND created_by = $3`,
        [user.dealerId, data.customerId, user.id]
      );
      if (dealerAccess.rows.length === 0) {
        throw new ForbiddenError('You are not authorized to confirm KYC documents for this customer');
      }
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
   * Generate short-lived (max 300s) pre-signed download URL (Strict Admin/Manager only).
   */
  public static async generatePresignedDownloadUrl(docId: string, user: AuthenticatedUser) {
    if (user.role === UserRole.COLLECTION_AGENT || user.role === UserRole.DEALER) {
      throw new ForbiddenError('You are not authorized to download raw KYC documents');
    }

    const docRes = await queryPostgres(
      'SELECT * FROM kyc_documents WHERE id = $1',
      [docId]
    );

    if (docRes.rows.length === 0) {
      throw new NotFoundError('KYC document not found');
    }

    const doc = docRes.rows[0];

    const storage = getStorageProvider();
    const downloadUrl = await storage.getSignedUrl({
      key: doc.storage_key,
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
      operation: 'getObject',
      mimeType: doc.file_mime_type,
    });

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
      expiresInSeconds: MAX_KYC_URL_EXPIRY_SECONDS,
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
           AND is_active = TRUE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`,
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

