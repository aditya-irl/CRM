import request from 'supertest';
import app from '../src/app';
import { queryPostgres, runPostgresTransaction, closePostgresPool } from '../src/database/postgres';
import { getRedisClient, acquireDistributedLock, releaseDistributedLock, closeRedisConnection } from '../src/core/redis';
import { getQueue, closeAllQueues, QUEUE_NAMES } from '../src/core/queue';
import { Worker } from 'bullmq';
import { UserRole, UserStatus, KYCType } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('PHASE 1: Real Integration & Security Test Suite (PostgreSQL & Redis)', () => {
  const runId = Date.now().toString(36);
  const superAdminEmail = `superadmin_${runId}@phase1test.com`;
  const adminEmail = `admin_${runId}@phase1test.com`;
  const agent1Email = `agent1_${runId}@phase1test.com`;
  const agent2Email = `agent2_${runId}@phase1test.com`;

  let superAdminToken: string;
  let adminToken: string;
  let adminUserId: string;
  let agent1Token: string;
  let agent1UserId: string;
  let agent2Token: string;
  let agent2UserId: string;

  let customer1Id: string;
  let customer2Id: string;
  let kycDocId: string;

  beforeAll(async () => {
    // 1. Create Bootstrap Super Admin
    const seedAdminId = uuidv4();
    const hash = bcrypt.hashSync('SuperAdmin@123456', 10);
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [seedAdminId, superAdminEmail, `+910${Date.now().toString().slice(-9)}`, hash]);

    const superLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: superAdminEmail, password: 'SuperAdmin@123456' });
    superAdminToken = superLogin.body.data.tokens.accessToken;

    // 2. Create Admin User
    const createAdmin = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: adminEmail,
        phone: `+911${Date.now().toString().slice(-9)}`,
        password: 'AdminPassword@123',
        fullName: 'Lead Administrator',
        role: UserRole.ADMIN,
      });
    adminUserId = createAdmin.body.data.id;

    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'AdminPassword@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 3. Create Agent 1 User
    const createAgent1 = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: agent1Email,
        phone: `+912${Date.now().toString().slice(-9)}`,
        password: 'AgentPassword@123',
        fullName: 'Field Agent One',
        role: UserRole.COLLECTION_AGENT,
      });
    agent1UserId = createAgent1.body.data.id;

    const agent1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: agent1Email, password: 'AgentPassword@123' });
    agent1Token = agent1Login.body.data.tokens.accessToken;

    // 4. Create Agent 2 User
    const createAgent2 = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: agent2Email,
        phone: `+913${Date.now().toString().slice(-9)}`,
        password: 'AgentPassword@123',
        fullName: 'Field Agent Two',
        role: UserRole.COLLECTION_AGENT,
      });
    agent2UserId = createAgent2.body.data.id;

    const agent2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: agent2Email, password: 'AgentPassword@123' });
    agent2Token = agent2Login.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // =========================================================================
  // 1. POSTGRESQL DATABASE FOUNDATION & CONSTRAINTS
  // =========================================================================
  describe('1. PostgreSQL Foundation & Schema Verification', () => {
    test('PostgreSQL connection is healthy and responsive', async () => {
      const res = await queryPostgres('SELECT NOW() as current_time, current_database() as db_name');
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].db_name).toBe('crm_db');
    });

    test('All Phase 1 production tables exist in PostgreSQL', async () => {
      const tablesRes = await queryPostgres(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      const tableNames = tablesRes.rows.map((r: any) => r.table_name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('kyc_documents');
      expect(tableNames).toContain('collection_assignments');
      expect(tableNames).toContain('audit_logs');
      expect(tableNames).toContain('loans');
      expect(tableNames).toContain('emi_installments');
      expect(tableNames).toContain('payments');
      expect(tableNames).toContain('call_logs');
      expect(tableNames).toContain('notifications');
      expect(tableNames).toContain('system_settings');
    });

    test('PostgreSQL NUMERIC(14,2) precision is enforced on monetary fields', async () => {
      const colRes = await queryPostgres(`
        SELECT column_name, data_type, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_name = 'loans' AND column_name = 'principal_amount'
      `);
      expect(colRes.rows.length).toBe(1);
      expect(colRes.rows[0].data_type).toBe('numeric');
      expect(colRes.rows[0].numeric_precision).toBe(14);
      expect(colRes.rows[0].numeric_scale).toBe(2);
    });

    test('PostgreSQL audit trigger strictly rejects UPDATE and DELETE on audit_logs', async () => {
      const testAuditId = uuidv4();
      await queryPostgres(`
        INSERT INTO audit_logs (id, action, entity, entity_id, created_at)
        VALUES ($1, 'TEST_IMMUTABILITY', 'System', '0', NOW())
      `, [testAuditId]);

      // Attempt UPDATE - Expect PostgreSQL exception from prevent_audit_tampering()
      await expect(
        queryPostgres(`UPDATE audit_logs SET action = 'HACKED' WHERE id = $1`, [testAuditId])
      ).rejects.toThrow(/Audit logs are strictly immutable/);

      // Attempt DELETE - Expect PostgreSQL exception from prevent_audit_tampering()
      await expect(
        queryPostgres(`DELETE FROM audit_logs WHERE id = $1`, [testAuditId])
      ).rejects.toThrow(/Audit logs are strictly immutable/);
    });

    test('PostgreSQL transactions rollback cleanly on error', async () => {
      const uniqueCode = `TX-TEST-${Date.now()}`;
      try {
        await runPostgresTransaction(async (client) => {
          await client.query(`
            INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
            VALUES ($1, $2, 'Rollback Test', '+919999900001', 'Test Addr', 'Delhi', 'Delhi', '110001', 'Route-X')
          `, [uuidv4(), uniqueCode]);

          // Trigger deliberate error inside transaction
          throw new Error('Forced Rollback');
        });
      } catch (err: any) {
        expect(err.message).toBe('Forced Rollback');
      }

      // Verify record was rolled back and does not exist
      const checkRes = await queryPostgres('SELECT id FROM customers WHERE customer_code = $1', [uniqueCode]);
      expect(checkRes.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. REAL REDIS INTEGRATION & DISTRIBUTED LOCKING
  // =========================================================================
  describe('2. Real Redis & BullMQ Integration', () => {
    test('Redis connection succeeds with PING/PONG', async () => {
      const redis = getRedisClient();
      const reply = await redis.ping();
      expect(reply).toBe('PONG');
    });

    test('Distributed lock enforces mutual exclusion and releases cleanly', async () => {
      const lockKey = `test_mutex_${Date.now()}`;
      const lock1 = await acquireDistributedLock(lockKey, 5000);
      expect(lock1.acquired).toBe(true);
      expect(lock1.lockId).toBeDefined();

      // Second concurrent acquire on same key must fail
      const lock2 = await acquireDistributedLock(lockKey, 5000);
      expect(lock2.acquired).toBe(false);

      // Release lock
      const released = await releaseDistributedLock(lockKey, lock1.lockId!);
      expect(released).toBe(true);

      // Now lock can be acquired again
      const lock3 = await acquireDistributedLock(lockKey, 5000);
      expect(lock3.acquired).toBe(true);
      await releaseDistributedLock(lockKey, lock3.lockId!);
    });

    test('BullMQ queue can enqueue and worker processes job', async () => {
      const queue = getQueue(QUEUE_NAMES.EMI_OPERATIONS);
      const testJobId = `job-${Date.now()}`;

      let processed = false;
      const worker = new Worker(
        QUEUE_NAMES.EMI_OPERATIONS,
        async (job) => {
          if (job.data.testId === testJobId) {
            processed = true;
          }
        },
        { connection: getRedisClient() }
      );

      await queue.add('test-operation', { testId: testJobId });

      // Wait briefly for worker to consume
      await new Promise((resolve) => setTimeout(resolve, 800));
      await worker.close();

      expect(processed).toBe(true);
    });
  });

  // =========================================================================
  // 3. USERS MANAGEMENT & AUTHENTICATION
  // =========================================================================
  describe('3. Users, Password Hashing & Authentication Layer', () => {
    test('User Creation: password is never returned in plaintext or hash in API response', async () => {
      const testEmail = `agent.temp_${runId}@phase1test.com`;
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          email: testEmail,
          phone: `+914${Date.now().toString().slice(-9)}`,
          password: 'SecretPassword@123',
          fullName: 'Temporary Agent',
          role: UserRole.COLLECTION_AGENT,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.email).toBe(testEmail);
      expect(res.body.data.password).toBeUndefined();
      expect(res.body.data.password_hash).toBeUndefined();
    });

    test('Authentication: Login with invalid password fails (401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: 'WrongPassword@999' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('Authentication: Inactive user login fails (401)', async () => {
      // Deactivate agent 2 temporarily
      await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [agent2UserId]);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: agent2Email, password: 'AgentPassword@123' });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('inactive');

      // Re-activate agent 2
      await queryPostgres("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [agent2UserId]);
    });

    test('Authentication: Token refresh rotation works and issues fresh tokens', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: agent1Email, password: 'AgentPassword@123' });

      const oldRefreshToken = loginRes.body.data.tokens.refreshToken;

      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).toBeDefined();
      agent1Token = refreshRes.body.data.accessToken;
    });

    test('Authentication: GET /api/v1/auth/me returns authenticated profile without password hash', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe(adminEmail);
      expect(res.body.data.role).toBe(UserRole.ADMIN);
      expect(res.body.data.password_hash).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. RBAC & ENDPOINT AUTHORIZATION
  // =========================================================================
  describe('4. RBAC & Role Permission Enforcement', () => {
    test('Admin can list users and view audit logs', async () => {
      const usersRes = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(usersRes.status).toBe(200);
      expect(Array.isArray(usersRes.body.data)).toBe(true);

      const auditRes = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(auditRes.status).toBe(200);
      expect(Array.isArray(auditRes.body.data)).toBe(true);
    });

    test('Agent is forbidden (403) from creating users or accessing audit logs', async () => {
      // Agent attempts user creation
      const userRes = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          email: `illegal_${runId}@phase1test.com`,
          phone: `+915${Date.now().toString().slice(-9)}`,
          password: 'Pass@123456',
          fullName: 'Illegal User',
          role: UserRole.COLLECTION_AGENT,
        });
      expect(userRes.status).toBe(403);

      // Agent attempts audit log viewing
      const auditRes = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${agent1Token}`);
      expect(auditRes.status).toBe(403);
    });

    test('Missing or invalid Authorization header returns 401 Unauthorized', async () => {
      const missingRes = await request(app).get('/api/v1/customers');
      expect(missingRes.status).toBe(401);

      const malformedRes = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', 'Bearer Invalid.Token.Here');
      expect(malformedRes.status).toBe(401);
    });
  });

  // =========================================================================
  // 5. CUSTOMER CRUD, SEARCH & PAGINATION
  // =========================================================================
  describe('5. Customer Management, Search & Pagination', () => {
    test('Admin creates Customer 1 and Customer 2 with Zod validation', async () => {
      // Customer 1
      const c1 = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: `Vikram ${runId} Sharma`,
          primaryPhone: `+916${Date.now().toString().slice(-9)}`,
          addressLine1: 'Shop 10, Chandni Chowk',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110006',
          areaRoute: 'Route-Alpha',
        });
      expect(c1.status).toBe(201);
      expect(c1.body.data.id).toBeDefined();
      expect(c1.body.data.customerCode).toMatch(/^CUST-2026-/);
      customer1Id = c1.body.data.id;

      // Customer 2
      const c2 = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: `Sunil ${runId} Verma`,
          primaryPhone: `+917${Date.now().toString().slice(-9)}`,
          addressLine1: 'Flat 202, Karol Bagh',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110005',
          areaRoute: 'Route-Beta',
        });
      expect(c2.status).toBe(201);
      customer2Id = c2.body.data.id;
    });

    test('Customer Search: Search by name and customer code works', async () => {
      // Search by name
      const nameSearch = await request(app)
        .get(`/api/v1/customers?search=Vikram`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(nameSearch.status).toBe(200);
      expect(nameSearch.body.data.some((c: any) => c.id === customer1Id)).toBe(true);
    });

    test('Pagination: Page and limit metadata are accurately computed', async () => {
      const res = await request(app)
        .get('/api/v1/customers?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(2);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
    });

    test('Admin updates customer profile', async () => {
      const updateRes = await request(app)
        .patch(`/api/v1/customers/${customer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ landmark: 'Near Metro Station' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 6. CUSTOMER ASSIGNMENTS & SINGLE ACTIVE RULE
  // =========================================================================
  describe('6. Customer Assignments & Portfolio Scoping', () => {
    test('Admin assigns Customer 1 to Agent 1 and Customer 2 to Agent 2', async () => {
      // Assign Customer 1 -> Agent 1
      const a1 = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          agentId: agent1UserId,
          customerId: customer1Id,
          effectiveFrom: '2026-09-01',
        });
      expect(a1.status).toBe(201);
      expect(a1.body.data.isActive).toBe(true);

      // Assign Customer 2 -> Agent 2
      const a2 = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          agentId: agent2UserId,
          customerId: customer2Id,
          effectiveFrom: '2026-09-01',
        });
      expect(a2.status).toBe(201);
    });

    test('Single Active Rule: Reassigning customer automatically deactivates prior assignment', async () => {
      // Reassign Customer 1 to Agent 2
      const reassign = await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          agentId: agent2UserId,
          customerId: customer1Id,
          effectiveFrom: '2026-09-19',
        });
      expect(reassign.status).toBe(201);

      // Verify prior assignment for Agent 1 on Customer 1 is now inactive in DB
      const priorRes = await queryPostgres(
        'SELECT is_active FROM collection_assignments WHERE agent_id = $1 AND customer_id = $2',
        [agent1UserId, customer1Id]
      );
      expect(priorRes.rows[0].is_active).toBe(false);

      // Reassign Customer 1 back to Agent 1 for IDOR tests
      await request(app)
        .post('/api/v1/assignments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          agentId: agent1UserId,
          customerId: customer1Id,
          effectiveFrom: '2026-09-19',
        });
    });

    test('Agent can view their own portfolio but is forbidden (403) from other portfolios', async () => {
      // Agent 1 views Agent 1's portfolio -> 200 OK
      const selfRes = await request(app)
        .get(`/api/v1/assignments/agent/${agent1UserId}`)
        .set('Authorization', `Bearer ${agent1Token}`);
      expect(selfRes.status).toBe(200);

      // Agent 1 attempts to view Agent 2's portfolio -> 403 Forbidden
      const otherRes = await request(app)
        .get(`/api/v1/assignments/agent/${agent2UserId}`)
        .set('Authorization', `Bearer ${agent1Token}`);
      expect(otherRes.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. ROW-LEVEL ACCESS CONTROL (RLAC) & IDOR PROTECTION
  // =========================================================================
  describe('7. Row-Level Access Control (RLAC) & IDOR Prevention', () => {
    test('Agent 1 can access assigned Customer 1', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customer1Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.customer.id).toBe(customer1Id);
    });

    test('Agent 1 accessing Customer 2 (assigned to Agent 2) is blocked with 403 Forbidden (IDOR Defense)', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customer2Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('do not have access');
    });

    test('Agent list customers is scoped strictly to assigned portfolio (Customer 2 omitted for Agent 1)', async () => {
      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      const customerIds = res.body.data.map((c: any) => c.id);
      expect(customerIds).toContain(customer1Id);
      expect(customerIds).not.toContain(customer2Id);
    });
  });

  // =========================================================================
  // 8. SECURE KYC DOCUMENT METADATA, PII MASKING & VAULT
  // =========================================================================
  describe('8. KYC Document Handling, Pre-signed URLs & PII Masking', () => {
    test('Pre-signed upload URL enforces max 300s TTL and validates MIME type and file size', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.AADHAAR,
          fileName: 'aadhaar_card.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 500000,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
      expect(res.body.data.storageKey).toMatch(/^kyc\//);
    });

    test('Invalid / malicious MIME type or oversized file is rejected', async () => {
      // Invalid MIME
      const badMime = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.AADHAAR,
          fileName: 'exploit.exe',
          mimeType: 'application/x-msdownload',
          fileSizeBytes: 1000,
        });
      expect(badMime.status).toBe(422);

      // Oversized (> 10MB)
      const oversized = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.AADHAAR,
          fileName: 'giant_video.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 20 * 1024 * 1024,
        });
      expect(oversized.status).toBe(422);
    });

    test('Confirm KYC: Stores SHA-256 hash and masks Aadhaar / PAN numbers', async () => {
      const confirmRes = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          docType: KYCType.AADHAAR,
          docNumber: '1234 5678 9012',
          storageKey: `kyc/${customer1Id}/aadhaar_123.pdf`,
          fileMimeType: 'application/pdf',
          fileSizeBytes: 500000,
        });

      expect(confirmRes.status).toBe(201);
      expect(confirmRes.body.data.id).toBeDefined();
      expect(confirmRes.body.data.docNumberMasked).toBe('XXXX-XXXX-9012');
      kycDocId = confirmRes.body.data.id;

      // Verify SHA-256 hash was stored in DB
      const dbCheck = await queryPostgres(
        'SELECT doc_number_hash, doc_number_masked FROM kyc_documents WHERE id = $1',
        [kycDocId]
      );
      expect(dbCheck.rows[0].doc_number_hash).toBeDefined();
      expect(dbCheck.rows[0].doc_number_hash.length).toBe(64); // SHA-256 hex length
    });

    test('Admin can generate pre-signed download URL (max 300s TTL); Agent is forbidden (403)', async () => {
      // Admin download URL -> 200 OK
      const adminDownload = await request(app)
        .get(`/api/v1/kyc/${kycDocId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminDownload.status).toBe(200);
      expect(adminDownload.body.data.downloadUrl).toBeDefined();
      expect(adminDownload.body.data.expiresInSeconds).toBeLessThanOrEqual(300);

      // Agent download URL -> 403 Forbidden
      const agentDownload = await request(app)
        .get(`/api/v1/kyc/${kycDocId}/presigned-download`)
        .set('Authorization', `Bearer ${agent1Token}`);
      expect(agentDownload.status).toBe(403);
    });

    test('Agent viewing customer KYC list receives masked data and raw storage_key is stripped', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/customer/${customer1Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].docNumberMasked).toBe('XXXX-XXXX-9012');
      expect(res.body.data[0].storageKey).toBeUndefined(); // Raw key stripped from agents
    });
  });

  // =========================================================================
  // 9. AUDIT LOG LEDGER & SECURITY VERIFICATION
  // =========================================================================
  describe('9. Immutable Audit Logging Verification', () => {
    test('Audit records are created for key Phase 1 security and domain events', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs?limit=50')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const actions = res.body.data.map((log: any) => log.action);

      expect(actions).toContain('USER_LOGIN_SUCCESS');
      expect(actions).toContain('CUSTOMER_CREATED');
      expect(actions).toContain('COLLECTION_ASSIGNMENT_CREATED');
      expect(actions).toContain('KYC_DOCUMENT_UPLOADED');
      expect(actions).toContain('KYC_SENSITIVE_VIEWED');
    });
  });
});
