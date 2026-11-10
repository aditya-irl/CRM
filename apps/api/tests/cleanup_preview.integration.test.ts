import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { UserRole } from '@crm/shared';
import bcrypt from 'bcryptjs';
import { SEED_MANAGER_ID, SEED_AGENT_RAHUL_ID, SEED_AGENT_PRIYA_ID } from '../src/database/seed';

describe('Production Cleanup Phase 1 Read-Only Preview Tests', () => {
  jest.setTimeout(60000);
  let adminToken: string;
  let managerToken: string;

  beforeAll(async () => {
    // Ensure test users exist in test database
    const passwordHash = bcrypt.hashSync('Admin@123456', 10);
    const agentPasswordHash = bcrypt.hashSync('Agent@123456', 10);
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at)
      VALUES 
        ('a0000000-0000-0000-0000-000000000001', 'admin@financecrm.com', '+919876500001', $1, 'Mr. Sparsh', 'SUPER_ADMIN', 'ACTIVE', 'Headquarters', NOW(), NOW()),
        ('a0000000-0000-0000-0000-000000000002', 'manager@financecrm.com', '+919876500002', $1, 'Anita Deshmukh (Branch Manager)', 'BRANCH_MANAGER', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ('a0000000-0000-0000-0000-000000000003', 'agent.rahul@financecrm.com', '+919876500003', $2, 'Rahul Sharma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ('a0000000-0000-0000-0000-000000000004', 'agent.priya@financecrm.com', '+919876500004', $2, 'Priya Verma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `, [passwordHash, agentPasswordHash]);

    // 1. Authenticate as Super Admin
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLoginRes.status).toBe(200);
    adminToken = adminLoginRes.body.data.tokens.accessToken;

    // 2. Authenticate as Branch Manager
    const managerLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@financecrm.com', password: 'Admin@123456' });

    expect(managerLoginRes.status).toBe(200);
    managerToken = managerLoginRes.body.data.tokens.accessToken;
  });

  describe('Authorization & Role Enforcement', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/system/cleanup/preview');
      expect(res.status).toBe(401);
    });

    it('rejects non-SUPER_ADMIN roles (e.g. BRANCH_MANAGER) with 403', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(403);
    });

    it('allows SUPER_ADMIN to access read-only preview', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('Preview Payload Invariants & Metadata', () => {
    it('returns database identity without leaking credentials or connection strings', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const { databaseIdentity } = res.body.data;
      expect(databaseIdentity).toBeDefined();
      expect(typeof databaseIdentity.databaseName).toBe('string');
      expect(typeof databaseIdentity.currentSchema).toBe('string');
      expect(typeof databaseIdentity.serverHost).toBe('string');
      expect(typeof databaseIdentity.pgVersion).toBe('string');

      // Sensitive leak verification
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain('postgresql://');
      expect(rawBody).not.toContain('postgres_secure_pass');
      expect(rawBody).not.toContain('password_hash');
    });

    it('returns row counts for all target tables', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const { operationalCounts, totalOperationalRows } = res.body.data;
      expect(Array.isArray(operationalCounts)).toBe(true);
      expect(operationalCounts.length).toBeGreaterThan(15);
      expect(typeof totalOperationalRows).toBe('number');

      // Verify key target tables are present
      const tableNames = operationalCounts.map((c: any) => c.table);
      expect(tableNames).toContain('customers');
      expect(tableNames).toContain('loans');
      expect(tableNames).toContain('payments');
      expect(tableNames).toContain('emi_installments');
      expect(tableNames).toContain('dealers');
      expect(tableNames).toContain('kyc_documents');
    });

    it('returns preserved staff accounts list with existence status', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const { preservedStaff, allStaffPresent } = res.body.data;
      expect(Array.isArray(preservedStaff)).toBe(true);
      expect(preservedStaff.length).toBe(1);

      const emails = preservedStaff.map((s: any) => s.email);
      expect(emails).toContain('admin@financecrm.com');
      expect(typeof allStaffPresent).toBe('boolean');
    });

    it('indicates readiness for Phase 2 handover execution', async () => {
      const res = await request(app)
        .get('/api/v1/system/cleanup/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const { cleanupReadiness } = res.body.data;
      expect(cleanupReadiness.phase).toBe('PHASE_2_READY');
      expect(cleanupReadiness.canProceedToPhase2).toBe(true);
      expect(cleanupReadiness.deletionEnabled).toBe(true);
      expect(cleanupReadiness.lockStatus).toBe('PROTECTED_BY_PASSWORD_AND_CONFIRMATION');
    });
  });

  describe('Session Re-Authentication & Password Checks', () => {
    it('verifies valid Super Admin password without modifying state', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/verify-session')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'Admin@123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('rejects incorrect password with 401', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/verify-session')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'IncorrectPassword' });

      expect(res.status).toBe(401);
    });
  });

  describe('Phase 2 Execution Security Gates & Transactional Purge', () => {
    it('rejects unauthenticated execute request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/execute')
        .send({
          confirmationPhrase: 'PURGE PRODUCTION TEST DATA',
          password: 'Admin@123456',
        });

      expect(res.status).toBe(401);
    });

    it('rejects non-SUPER_ADMIN role (BRANCH_MANAGER) with 403', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/execute')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          confirmationPhrase: 'PURGE PRODUCTION TEST DATA',
          password: 'Admin@123456',
        });

      expect(res.status).toBe(403);
    });

    it('rejects invalid confirmation phrase with 400', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/execute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirmationPhrase: 'DELETE EVERYTHING',
          password: 'Admin@123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Invalid confirmation phrase');
    });

    it('rejects invalid Super Admin password with 401', async () => {
      const res = await request(app)
        .post('/api/v1/system/cleanup/execute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirmationPhrase: 'PURGE PRODUCTION TEST DATA',
          password: 'WrongPassword@123',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('Administrator re-authentication failed');
    });

    it('successfully executes atomic transactional purge and verifies zero operational rows', async () => {
      // 1. Seed sample operational data in test DB to ensure deletion executes across tables
      const testCustomerId = 'b0000000-0000-0000-0000-000000000001';
      await queryPostgres(`
        INSERT INTO customers (
          id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by
        ) VALUES (
          $1, 'CUST-TEST-001', 'Test Borrower', '+919999900001', '123 Test St', 'Mumbai', 'Maharashtra', '400001', 'Route 1',
          (SELECT id FROM users WHERE email = 'admin@financecrm.com')
        )
        ON CONFLICT (id) DO NOTHING
      `, [testCustomerId]);

      await queryPostgres(`
        INSERT INTO audit_logs (id, user_id, action, entity, entity_id, created_at)
        VALUES (
          'c0000000-0000-0000-0000-000000000001',
          (SELECT id FROM users WHERE email = 'admin@financecrm.com'),
          'TEST_ACTION',
          'CUSTOMER',
          $1,
          NOW()
        )
        ON CONFLICT (id) DO NOTHING
      `, [testCustomerId]);

      // 2. Call Phase 2 Execution with correct password and confirmation phrase
      const res = await request(app)
        .post('/api/v1/system/cleanup/execute')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          confirmationPhrase: 'PURGE PRODUCTION TEST DATA',
          password: 'Admin@123456',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const result = res.body.data;
      expect(result.status).toBe('COMPLETED_SUCCESSFULLY');
      expect(result.databaseIdentity).toBeDefined();
      expect(result.auditLogId).toBeDefined();
      expect(result.executedBy).toBe('admin@financecrm.com');

      // 3. Post-cleanup verification in database
      const customerCount = await queryPostgres<{ count: number }>('SELECT COUNT(*)::int as count FROM customers');
      expect(customerCount.rows[0].count).toBe(0);

      const loanCount = await queryPostgres<{ count: number }>('SELECT COUNT(*)::int as count FROM loans');
      expect(loanCount.rows[0].count).toBe(0);

      const paymentCount = await queryPostgres<{ count: number }>('SELECT COUNT(*)::int as count FROM payments');
      expect(paymentCount.rows[0].count).toBe(0);

      const auditCount = await queryPostgres<{ count: number }>('SELECT COUNT(*)::int as count FROM audit_logs');
      expect(auditCount.rows[0].count).toBe(1); // The immutable SYSTEM_HANDOVER_INITIALIZED log

      const handoverAudit = await queryPostgres<{ action: string; entity: string }>(
        'SELECT action, entity FROM audit_logs WHERE id = $1',
        [result.auditLogId]
      );
      expect(handoverAudit.rows[0].action).toBe('SYSTEM_HANDOVER_INITIALIZED');

      // Preserved staff accounts check
      const userCount = await queryPostgres<{ count: number }>('SELECT COUNT(*)::int as count FROM users');
      expect(userCount.rows[0].count).toBe(1);

      const preservedStaffRes = await queryPostgres<{ email: string }>(
        'SELECT email FROM users ORDER BY email'
      );
      const remainingEmails = preservedStaffRes.rows.map((r) => r.email.toLowerCase());
      expect(remainingEmails).toEqual(['admin@financecrm.com']);
    });
  });

  afterAll(async () => {
    // Re-seed the other staff users in local test DB so subsequent test suites have their accounts
    const passwordHash = bcrypt.hashSync('Admin@123456', 10);
    const agentPasswordHash = bcrypt.hashSync('Agent@123456', 10);
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, assigned_branch, created_at, updated_at)
      VALUES 
        ($1, 'manager@financecrm.com', '+919876500002', $4, 'Anita Deshmukh (Branch Manager)', 'BRANCH_MANAGER', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ($2, 'agent.rahul@financecrm.com', '+919876500003', $5, 'Rahul Sharma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW()),
        ($3, 'agent.priya@financecrm.com', '+919876500004', $5, 'Priya Verma (Field Agent)', 'COLLECTION_AGENT', 'ACTIVE', 'North Branch', NOW(), NOW())
      ON CONFLICT (email) DO NOTHING
    `, [SEED_MANAGER_ID, SEED_AGENT_RAHUL_ID, SEED_AGENT_PRIYA_ID, passwordHash, agentPasswordHash]);
  });
});

