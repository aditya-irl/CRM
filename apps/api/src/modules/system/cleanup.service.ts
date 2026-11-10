import { queryPostgres, getEffectiveDatabaseConfig, runPostgresTransaction } from '../../database/postgres';
import { env } from '../../config/env';
import {
  IProductionCleanupPreview,
  IProductionCleanupExecutionResult,
  ICleanupTableCount,
  IPreservedStaffAccount,
  IDatabaseIdentityPreview,
  UserRole,
} from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import bcrypt from 'bcryptjs';
import { UnauthorizedError, ForbiddenError, BadRequestError } from '../../middlewares/error.middleware';
import { randomUUID } from 'crypto';

export const PRESERVED_STAFF_EMAILS = [
  'admin@financecrm.com',
];

export const CLEANUP_TARGET_TABLES: Array<{
  table: string;
  category: ICleanupTableCount['category'];
  description: string;
}> = [
  { table: 'cashfree_orders', category: 'CASHFREE', description: 'Cashfree payment orders created for checkout sessions' },
  { table: 'cashfree_webhook_events', category: 'CASHFREE', description: 'Incoming payment webhook event deduplication records' },
  { table: 'customer_portal_tokens', category: 'CASHFREE', description: 'Customer payment portal magic link access tokens' },
  { table: 'customer_kyc_verifications', category: 'CUSTOMERS', description: 'Borrower KYC self-service profile verification events' },
  { table: 'customer_kyc_correction_requests', category: 'CUSTOMERS', description: 'Customer portal profile edit and correction tickets' },
  { table: 'customer_contact_activities', category: 'COLLECTIONS', description: 'Agent borrower recovery and field contact activity logs' },
  { table: 'call_logs', category: 'COLLECTIONS', description: 'Agent telephonic follow-ups and disposition logs' },
  { table: 'collection_assignments', category: 'COLLECTIONS', description: 'Field agent portfolio collection queue assignments' },
  { table: 'dealer_settlement_allocations', category: 'DEALERS', description: 'Itemized repayment allocations for dealer batch settlements' },
  { table: 'dealer_settlements', category: 'DEALERS', description: 'Partner merchant settlement statements and records' },
  { table: 'dealer_payable_allocations', category: 'DEALERS', description: 'Device purchase payout allocations to dealer accounts' },
  { table: 'dealer_payable_payments', category: 'DEALERS', description: 'Company payout disbursements for dealer partner inventory' },
  { table: 'payments', category: 'LOANS_EMIS', description: 'Customer EMI repayments, down payments, and penalty receipts' },
  { table: 'emi_penalties', category: 'LOANS_EMIS', description: 'Late payment overdue penalty records and fee accruals' },
  { table: 'emi_installments', category: 'LOANS_EMIS', description: 'Scheduled monthly amortization installments' },
  { table: 'loans', category: 'LOANS_EMIS', description: 'Device financing loan contracts and disbursement accounts' },
  { table: 'kyc_documents', category: 'CUSTOMERS', description: 'Uploaded Aadhaar, PAN, photo, and agreement documents' },
  { table: 'notifications', category: 'SYSTEM', description: 'Automated SMS, WhatsApp, and push notification dispatches' },
  { table: 'dealers', category: 'DEALERS', description: 'Partner dealer stores and merchant trading profiles' },
  { table: 'customers', category: 'CUSTOMERS', description: 'Customer and borrower KYC profiles' },
  { table: 'audit_logs', category: 'SYSTEM', description: 'Historical operational audit trail and lifecycle log entries' },
];

/**
 * Foreign key safe deletion sequence from leaf dependencies to root tables.
 */
export const OPERATIONAL_TABLES_DELETION_ORDER: string[] = [
  'customer_portal_tokens',
  'customer_kyc_correction_requests',
  'customer_kyc_verifications',
  'customer_contact_activities',
  'call_logs',
  'collection_assignments',
  'cashfree_orders',
  'cashfree_webhook_events',
  'dealer_settlement_allocations',
  'dealer_payable_allocations',
  'dealer_settlements',
  'dealer_payable_payments',
  'emi_penalties',
  'payments',
  'emi_installments',
  'kyc_documents',
  'notifications',
  'loans',
  'customers',
  'dealers',
];

export const REQUIRED_CONFIRMATION_PHRASE = 'PURGE PRODUCTION TEST DATA';

function sanitizeHost(rawHost?: string | null): string {
  if (!rawHost) return 'unknown';
  const trimmed = rawHost.trim();
  if (trimmed === 'localhost' || trimmed === '127.0.0.1' || trimmed === '::1') {
    return 'localhost (Workstation Development)';
  }
  if (trimmed.includes('neon.tech')) {
    const parts = trimmed.split('.');
    if (parts.length >= 3) {
      const prefix = parts[0].slice(0, 11);
      return `${prefix}***.${parts.slice(1).join('.')}`;
    }
    return 'Neon Serverless PostgreSQL (aws.neon.tech)';
  }
  if (trimmed.includes('render.com')) {
    return 'Render Managed PostgreSQL (render.com)';
  }
  const domainParts = trimmed.split('.');
  if (domainParts.length > 2) {
    return `***.${domainParts.slice(-2).join('.')}`;
  }
  return 'Remote Managed PostgreSQL Host';
}

export class CleanupService {
  private static isExecuting = false;

  /**
   * Safe read-only inspection of PostgreSQL database identity.
   */
  public static async getDatabaseIdentity(): Promise<IDatabaseIdentityPreview> {
    const identRes = await queryPostgres<{
      db_name: string;
      schema_name: string;
      server_ip: string | null;
      server_port: number | null;
      pg_version: string;
    }>(`
      SELECT 
        current_database() as db_name,
        current_schema() as schema_name,
        inet_server_addr()::text as server_ip,
        inet_server_port() as server_port,
        version() as pg_version
    `);

    const identRow = identRes.rows[0] || {
      db_name: 'unknown',
      schema_name: 'public',
      server_ip: null,
      server_port: null,
      pg_version: 'PostgreSQL',
    };

    let sslActive = false;
    try {
      const sslRes = await queryPostgres<{ ssl: boolean }>(
        'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
      );
      if (sslRes.rows.length > 0 && sslRes.rows[0].ssl !== undefined) {
        sslActive = Boolean(sslRes.rows[0].ssl);
      } else {
        sslActive = env.DATABASE_SSL === 'true' || env.DATABASE_SSL === 'no-verify';
      }
    } catch {
      sslActive = env.DATABASE_SSL === 'true' || env.DATABASE_SSL === 'no-verify';
    }

    let rawHost = 'localhost';
    try {
      const config = getEffectiveDatabaseConfig();
      const parsedUrl = new URL(config.connectionString);
      rawHost = parsedUrl.hostname;
    } catch {
      rawHost = 'localhost';
    }

    const isNeonHost = rawHost.includes('neon.tech') || identRow.pg_version.toLowerCase().includes('neon');
    const isLocalHost = rawHost === 'localhost' || rawHost === '127.0.0.1';
    const providerGuess: IDatabaseIdentityPreview['providerGuess'] = isNeonHost
      ? 'Neon PostgreSQL'
      : isLocalHost
      ? 'Local PostgreSQL'
      : 'Managed PostgreSQL';

    return {
      databaseName: identRow.db_name,
      currentSchema: identRow.schema_name || 'public',
      serverHost: sanitizeHost(rawHost),
      serverPort: identRow.server_port,
      serverIp: identRow.server_ip,
      pgVersion: identRow.pg_version.split(' on ')[0] || identRow.pg_version.slice(0, 50),
      sslActive,
      providerGuess,
    };
  }

  /**
   * Phase 1 & 2 Preview: Strictly read-only preview of production database identity and target record counts.
   */
  public static async getPreview(user: AuthenticatedUser): Promise<IProductionCleanupPreview> {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only SUPER_ADMIN is authorized to inspect system handover preview');
    }

    // 1. Inspect Database Identity
    const databaseIdentity = await this.getDatabaseIdentity();

    // 2. Query Row Counts for All Cleanup-Target Tables (Read-Only)
    const operationalCounts: ICleanupTableCount[] = [];
    let totalOperationalRows = 0;

    for (const item of CLEANUP_TARGET_TABLES) {
      try {
        const countRes = await queryPostgres<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM "${item.table}"`
        );
        const count = countRes.rows[0]?.count ?? 0;
        operationalCounts.push({
          table: item.table,
          category: item.category,
          rowCount: count,
          description: item.description,
        });
        totalOperationalRows += count;
      } catch (err: any) {
        operationalCounts.push({
          table: item.table,
          category: item.category,
          rowCount: 0,
          description: `${item.description} (table not present)`,
        });
      }
    }

    // Include test idempotency settings keys
    try {
      const idempRes = await queryPostgres<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM system_settings WHERE key LIKE 'idempotency:%'`
      );
      const idempCount = idempRes.rows[0]?.count ?? 0;
      operationalCounts.push({
        table: 'system_settings (test idempotency)',
        category: 'SYSTEM',
        rowCount: idempCount,
        description: 'Temporary customer onboarding idempotency locks',
      });
      totalOperationalRows += idempCount;
    } catch {}

    // Include non-staff test accounts (dealers and agents created during testing)
    try {
      const nonStaffRes = await queryPostgres<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM users WHERE LOWER(email) NOT IN (${PRESERVED_STAFF_EMAILS.map(
          (_, i) => `$${i + 1}`
        ).join(', ')})`,
        PRESERVED_STAFF_EMAILS.map((e) => e.toLowerCase())
      );
      const nonStaffCount = nonStaffRes.rows[0]?.count ?? 0;
      operationalCounts.push({
        table: 'users (test accounts)',
        category: 'SYSTEM',
        rowCount: nonStaffCount,
        description: 'Temporary test dealer and field agent user accounts',
      });
      totalOperationalRows += nonStaffCount;
    } catch {}

    // 3. Inspect Preserved Staff Accounts
    const staffRes = await queryPostgres<{
      id: string;
      email: string;
      full_name: string;
      role: string;
      status: string;
    }>(
      `SELECT id, email, full_name, role, status FROM users WHERE LOWER(email) = ANY($1::text[])`,
      [PRESERVED_STAFF_EMAILS.map((e) => e.toLowerCase())]
    );

    const staffMap = new Map<string, (typeof staffRes.rows)[0]>();
    for (const r of staffRes.rows) {
      staffMap.set(r.email.toLowerCase(), r);
    }

    const preservedStaff: IPreservedStaffAccount[] = PRESERVED_STAFF_EMAILS.map((email) => {
      const found = staffMap.get(email.toLowerCase());
      if (found) {
        return {
          id: found.id,
          email: found.email,
          fullName: found.full_name,
          role: found.role,
          status: found.status,
          exists: true,
        };
      }
      return {
        id: '',
        email,
        fullName: 'Missing Staff Account',
        role: email.includes('admin') ? 'SUPER_ADMIN' : email.includes('manager') ? 'BRANCH_MANAGER' : 'COLLECTION_AGENT',
        status: 'ABSENT',
        exists: false,
      };
    });

    const allStaffPresent = preservedStaff.every((s) => s.exists);

    // 4. Inspect System Settings & Migrations Status
    let allowDealerPenalty: boolean | null = null;
    let totalSettings = 0;
    try {
      const penaltyRes = await queryPostgres<{ value: any }>(
        `SELECT value FROM system_settings WHERE key = 'ALLOW_DEALER_PENALTY'`
      );
      if (penaltyRes.rows.length > 0) {
        allowDealerPenalty = Boolean(penaltyRes.rows[0].value);
      }
      const totalSettingsRes = await queryPostgres<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM system_settings WHERE key NOT LIKE 'idempotency:%'`
      );
      totalSettings = totalSettingsRes.rows[0]?.count ?? 0;
    } catch {}

    let migrationsCount = 0;
    let latestMigration: string | null = null;
    try {
      const migRes = await queryPostgres<{ count: number; latest: string | null }>(
        `SELECT COUNT(*)::int as count, MAX(name) as latest FROM _migrations`
      );
      migrationsCount = migRes.rows[0]?.count ?? 0;
      latestMigration = migRes.rows[0]?.latest ?? null;
    } catch {}

    const cashfreeConfigured = Boolean(
      env.CASHFREE_CLIENT_ID && env.CASHFREE_CLIENT_ID.trim().length > 0 &&
      env.CASHFREE_CLIENT_SECRET && env.CASHFREE_CLIENT_SECRET.trim().length > 0
    );

    const canProceed = allStaffPresent && migrationsCount > 0;

    return {
      databaseIdentity,
      operationalCounts,
      totalOperationalRows,
      preservedStaff,
      allStaffPresent,
      systemSettings: {
        allowDealerPenalty,
        totalSettings,
        migrationsCount,
        latestMigration,
        cashfreeEnv: env.CASHFREE_ENV,
        cashfreeConfigured,
      },
      cleanupReadiness: {
        phase: canProceed ? 'PHASE_2_READY' : 'PHASE_1_PREVIEW',
        canProceedToPhase2: canProceed,
        deletionEnabled: canProceed,
        lockStatus: canProceed ? 'PROTECTED_BY_PASSWORD_AND_CONFIRMATION' : 'DELETION_LOCKED',
        message: canProceed
          ? 'Phase 2 Ready. Transactional deletion is available and strictly guarded by Super Admin re-authentication and confirmation phrase.'
          : 'Phase 2 Blocked: Preserved staff accounts or database migrations are incomplete.',
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Re-verifies current Super Admin password without making any state mutations.
   */
  public static async verifyAdminSession(user: AuthenticatedUser, password: string): Promise<{ success: boolean; message: string }> {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only SUPER_ADMIN can verify administrative handover session');
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new UnauthorizedError('Administrator password is required for session verification');
    }

    const userRes = await queryPostgres<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [user.id]
    );

    if (userRes.rows.length === 0) {
      throw new UnauthorizedError('Administrator user record not found in active database');
    }

    const isMatch = bcrypt.compareSync(password.trim(), userRes.rows[0].password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Administrator re-authentication failed: incorrect password');
    }

    return {
      success: true,
      message: 'Administrator session confirmed and verified for handover preview',
    };
  }

  /**
   * Phase 2: Transactional cleanup of all operational test data.
   *
   * Safeguards:
   * 1. SUPER_ADMIN authorization only
   * 2. Concurrency lock to prevent overlapping runs
   * 3. Exact confirmation phrase check ("PURGE PRODUCTION TEST DATA")
   * 4. Super Admin password verification via bcrypt
   * 5. Verification that all 4 preserved staff accounts exist before deleting
   * 6. Transactional execution with circular FK handling and audit log trigger handling
   * 7. Post-cleanup zero-record verification for all target operational tables
   * 8. Creation of immutable SYSTEM_HANDOVER_INITIALIZED audit event
   */
  public static async executeCleanup(
    user: AuthenticatedUser,
    confirmationPhrase: string,
    password: string,
    clientIp?: string,
    userAgent?: string
  ): Promise<IProductionCleanupExecutionResult> {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only SUPER_ADMIN is authorized to execute production data cleanup');
    }

    if (CleanupService.isExecuting) {
      throw new BadRequestError('Another cleanup operation is currently in progress. Please wait.');
    }

    if (!confirmationPhrase || typeof confirmationPhrase !== 'string' || confirmationPhrase.trim() !== REQUIRED_CONFIRMATION_PHRASE) {
      throw new BadRequestError(`Invalid confirmation phrase. Exact phrase required: "${REQUIRED_CONFIRMATION_PHRASE}"`);
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      throw new UnauthorizedError('Administrator password is required to execute handover purge');
    }

    CleanupService.isExecuting = true;

    try {
      // 1. Re-verify Super Admin Password
      const userRes = await queryPostgres<{ password_hash: string; email: string }>(
        'SELECT password_hash, email FROM users WHERE id = $1',
        [user.id]
      );

      if (userRes.rows.length === 0) {
        throw new UnauthorizedError('Administrator user record not found in active database');
      }

      const isMatch = bcrypt.compareSync(password.trim(), userRes.rows[0].password_hash);
      if (!isMatch) {
        throw new UnauthorizedError('Administrator re-authentication failed: incorrect password');
      }

      // 2. Pre-execution verification: ensure all 4 preserved staff accounts exist
      const staffRes = await queryPostgres<{
        id: string;
        email: string;
        full_name: string;
        role: string;
        status: string;
      }>(
        `SELECT id, email, full_name, role, status FROM users WHERE LOWER(email) = ANY($1::text[])`,
        [PRESERVED_STAFF_EMAILS.map((e) => e.toLowerCase())]
      );

      const staffMap = new Map<string, (typeof staffRes.rows)[0]>();
      for (const r of staffRes.rows) {
        staffMap.set(r.email.toLowerCase(), r);
      }

      const preservedStaff: IPreservedStaffAccount[] = PRESERVED_STAFF_EMAILS.map((email) => {
        const found = staffMap.get(email.toLowerCase());
        if (found) {
          return {
            id: found.id,
            email: found.email,
            fullName: found.full_name,
            role: found.role,
            status: found.status,
            exists: true,
          };
        }
        return {
          id: '',
          email,
          fullName: 'Missing Staff Account',
          role: email.includes('admin') ? 'SUPER_ADMIN' : email.includes('manager') ? 'BRANCH_MANAGER' : 'COLLECTION_AGENT',
          status: 'ABSENT',
          exists: false,
        };
      });

      const missingStaff = preservedStaff.filter((s) => !s.exists);
      if (missingStaff.length > 0) {
        throw new BadRequestError(
          `Cannot execute cleanup: Required staff account(s) missing from database: ${missingStaff.map((s) => s.email).join(', ')}`
        );
      }

      // 3. Collect pre-cleanup counts for the audit trail
      const preDeletedCounts: Record<string, number> = {};
      for (const item of CLEANUP_TARGET_TABLES) {
        try {
          const cRes = await queryPostgres<{ count: number }>(`SELECT COUNT(*)::int as count FROM "${item.table}"`);
          preDeletedCounts[item.table] = cRes.rows[0]?.count ?? 0;
        } catch {
          preDeletedCounts[item.table] = 0;
        }
      }

      try {
        const idempRes = await queryPostgres<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM system_settings WHERE key LIKE 'idempotency:%'`
        );
        preDeletedCounts['system_settings_idempotency'] = idempRes.rows[0]?.count ?? 0;
      } catch {
        preDeletedCounts['system_settings_idempotency'] = 0;
      }

      try {
        const nonStaffRes = await queryPostgres<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM users WHERE LOWER(email) NOT IN (${PRESERVED_STAFF_EMAILS.map(
            (_, i) => `$${i + 1}`
          ).join(', ')})`,
          PRESERVED_STAFF_EMAILS.map((e) => e.toLowerCase())
        );
        preDeletedCounts['users_non_staff'] = nonStaffRes.rows[0]?.count ?? 0;
      } catch {
        preDeletedCounts['users_non_staff'] = 0;
      }

      const databaseIdentity = await this.getDatabaseIdentity();

      // 4. Execute atomic cleanup transaction
      const auditLogId = randomUUID();
      const executionTimestamp = new Date().toISOString();

      await runPostgresTransaction(async (client) => {
        // Step 4a: Nullify circular foreign keys and self-references
        await client.query(`UPDATE users SET dealer_id = NULL WHERE dealer_id IS NOT NULL`);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dealers') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dealers' AND column_name = 'user_id') THEN
                UPDATE dealers SET user_id = NULL WHERE user_id IS NOT NULL;
              END IF;
            END IF;
          END $$;
        `);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payments') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'payments' AND column_name = 'reversed_payment_id') THEN
                UPDATE payments SET reversed_payment_id = NULL WHERE reversed_payment_id IS NOT NULL;
              END IF;
            END IF;
          END $$;
        `);
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_settings') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'system_settings' AND column_name = 'updated_by') THEN
                UPDATE system_settings SET updated_by = NULL WHERE updated_by IS NOT NULL;
              END IF;
            END IF;
          END $$;
        `);

        // Step 4b: Delete operational tables in reverse dependency order (TRUNCATE when unreferenced for instant performance, fallback to DELETE)
        for (const tableName of OPERATIONAL_TABLES_DELETION_ORDER) {
          await client.query(`
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tableName}') THEN
                BEGIN
                  EXECUTE 'TRUNCATE TABLE "' || '${tableName}' || '"';
                EXCEPTION WHEN OTHERS THEN
                  EXECUTE 'DELETE FROM "' || '${tableName}' || '"';
                END;
              END IF;
            END $$;
          `);
        }

        // Step 4c: Clean idempotency keys from system_settings
        await client.query(`DELETE FROM system_settings WHERE key LIKE 'idempotency:%'`);

        // Step 4d: Clear existing audit logs with trigger protection temporarily bypassed
        await client.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_audit_logs') THEN
              ALTER TABLE audit_logs DISABLE TRIGGER trg_protect_audit_logs;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
              BEGIN
                TRUNCATE TABLE audit_logs;
              EXCEPTION WHEN OTHERS THEN
                DELETE FROM audit_logs;
              END;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_audit_logs') THEN
              ALTER TABLE audit_logs ENABLE TRIGGER trg_protect_audit_logs;
            END IF;
          END $$;
        `);

        // Step 4e: Delete non-staff user accounts
        await client.query(
          `DELETE FROM users WHERE LOWER(email) NOT IN (${PRESERVED_STAFF_EMAILS.map((_, i) => `$${i + 1}`).join(', ')})`,
          PRESERVED_STAFF_EMAILS.map((e) => e.toLowerCase())
        );

        // Step 4f: Post-cleanup verification within transaction
        for (const tableName of OPERATIONAL_TABLES_DELETION_ORDER) {
          const checkRes = await client.query<{ count: number }>(`
            SELECT (
              CASE WHEN EXISTS (
                SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tableName}'
              ) THEN (SELECT COUNT(*)::int FROM "${tableName}")
              ELSE 0 END
            ) as count
          `);
          const count = checkRes.rows[0]?.count ?? 0;
          if (count > 0) {
            throw new Error(`[POST-CLEANUP VERIFICATION FAILURE] Table "${tableName}" has ${count} records remaining (expected 0)`);
          }
        }

        const idempCheck = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM system_settings WHERE key LIKE 'idempotency:%'`
        );
        if ((idempCheck.rows[0]?.count ?? 0) > 0) {
          throw new Error('[POST-CLEANUP VERIFICATION FAILURE] Residual idempotency settings remain in database');
        }

        const userCountCheck = await client.query<{ count: number }>(`SELECT COUNT(*)::int as count FROM users`);
        const totalUsers = userCountCheck.rows[0]?.count ?? 0;
        if (totalUsers !== PRESERVED_STAFF_EMAILS.length) {
          throw new Error(
            `[POST-CLEANUP VERIFICATION FAILURE] Users table has ${totalUsers} accounts remaining (expected exactly ${PRESERVED_STAFF_EMAILS.length} preserved staff)`
          );
        }

        // Step 4g: Insert immutable SYSTEM_HANDOVER_INITIALIZED audit record
        await client.query(
          `INSERT INTO audit_logs (
            id,
            user_id,
            action,
            entity,
            entity_id,
            previous_state,
            new_state,
            ip_address,
            user_agent,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            auditLogId,
            user.id,
            'SYSTEM_HANDOVER_INITIALIZED',
            'SYSTEM',
            'PRODUCTION_DATABASE',
            JSON.stringify({
              preCleanupCounts: preDeletedCounts,
              totalOperationalPurged: Object.values(preDeletedCounts).reduce((a, b) => a + b, 0),
            }),
            JSON.stringify({
              status: 'READY_FOR_CLIENT',
              preservedStaffEmails: PRESERVED_STAFF_EMAILS,
              handoverVerifiedAt: executionTimestamp,
            }),
            clientIp || null,
            userAgent || null,
          ]
        );
      });

      // Construct verified post-cleanup counts (all operational tables 0)
      const verifiedAfterCounts: Record<string, number> = {};
      for (const item of CLEANUP_TARGET_TABLES) {
        if (item.table === 'audit_logs') {
          verifiedAfterCounts[item.table] = 1; // 1 immutable handover log created
        } else {
          verifiedAfterCounts[item.table] = 0;
        }
      }
      verifiedAfterCounts['system_settings_idempotency'] = 0;
      verifiedAfterCounts['users_non_staff'] = 0;

      return {
        success: true,
        databaseIdentity,
        deletedCounts: preDeletedCounts,
        verifiedAfterCounts,
        preservedStaff,
        auditLogId,
        executedAt: executionTimestamp,
        executedBy: user.email,
        status: 'COMPLETED_SUCCESSFULLY',
        message: 'All operational testing data successfully wiped in atomic transaction. Database is fully verified and prepared for client handover.',
      };
    } finally {
      CleanupService.isExecuting = false;
    }
  }
}

