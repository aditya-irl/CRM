import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { v4 as uuidv4 } from 'uuid';

describe('Audit Event Detail API & Security Integration Tests', () => {
  let adminToken: string;
  let dealerToken: string;
  let testAuditLogId: string;
  const runId = Date.now().toString(36);

  beforeAll(async () => {
    // 1. Authenticate as Admin / Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create a test dealer and login account
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Audit Test Store ${runId}`,
        ownerName: 'Test Owner',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: '100 Audit Rd',
        areaCity: 'Dadri',
      });
    expect(dealerRes.status).toBe(201);
    const dealerId = dealerRes.body.data.id;
    const dealerCode = dealerRes.body.data.dealerCode;

    const accountRes = await request(app)
      .post(`/api/v1/dealers/${dealerId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(accountRes.status).toBe(201);
    const tempPassword = accountRes.body.data.temporaryPassword;

    // Login as dealer
    const dealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerCode, password: tempPassword });
    expect(dealerLogin.status).toBe(200);
    dealerToken = dealerLogin.body.data.tokens.accessToken;

    // 3. Insert a dedicated test audit log with metadata & sensitive keys to test redaction
    const insertRes = await queryPostgres(
      `INSERT INTO audit_logs (
        id, user_id, action, entity, entity_id, previous_state, new_state, ip_address, user_agent, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id`,
      [
        uuidv4(),
        null,
        'SYSTEM_CONFIG_UPDATED',
        'SystemSettings',
        uuidv4(),
        JSON.stringify({
          status: 'INACTIVE',
          secretKey: 'super_secret_raw_key',
          passwordHash: '$2b$10$hashed_password_val',
        }),
        JSON.stringify({
          status: 'ACTIVE',
          secretKey: 'updated_secret_key',
          passwordHash: '$2b$10$hashed_password_val',
          refreshToken: 'refresh_token_abc',
          userAadhaar: '987654321098',
          userPan: 'ABCDE9876F',
        }),
        '10.0.0.1',
        'Jest-Audit-Agent/1.0',
      ]
    );
    testAuditLogId = insertRes.rows[0].id;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  describe('1. GET /api/v1/audit-logs (List Endpoint)', () => {
    test('Admin can list audit logs and response contains summary fields', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    test('Dealer is blocked from accessing audit log list (403)', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${dealerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. GET /api/v1/audit-logs/:id (Detail Endpoint)', () => {
    test('Admin can fetch full enriched audit event details', async () => {
      const res = await request(app)
        .get(`/api/v1/audit-logs/${testAuditLogId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const detail = res.body.data;

      // Event Information
      expect(detail.id).toBe(testAuditLogId);
      expect(detail.action).toBe('SYSTEM_CONFIG_UPDATED');
      expect(detail.entity).toBe('SystemSettings');
      expect(detail.createdAt).toBeDefined();

      // Actor
      expect(detail.actor).toBeDefined();
      expect(detail.actor.ipAddress).toBe('10.0.0.1');
      expect(detail.actor.userAgent).toBe('Jest-Audit-Agent/1.0');

      // Target
      expect(detail.target).toBeDefined();
      expect(detail.target.entity).toBe('SystemSettings');

      // Changes diff
      expect(Array.isArray(detail.changes)).toBe(true);
      const statusChange = detail.changes.find((c: any) => c.field === 'status');
      expect(statusChange).toBeDefined();
      expect(statusChange.previousValue).toBe('INACTIVE');
      expect(statusChange.newValue).toBe('ACTIVE');

      // Verify Sensitive Data Redaction at Backend Serialization Boundary
      expect(detail.previousState.secretKey).toBe('[REDACTED]');
      expect(detail.previousState.passwordHash).toBe('[REDACTED]');
      expect(detail.newState.secretKey).toBe('[REDACTED]');
      expect(detail.newState.refreshToken).toBe('[REDACTED]');
      expect(detail.newState.userAadhaar).toBe('XXXX-XXXX-1098');
      expect(detail.newState.userPan).toBe('ABCDE****F');
    });

    test('Returns 404 for nonexistent audit log event ID', async () => {
      const nonExistentId = uuidv4();
      const res = await request(app)
        .get(`/api/v1/audit-logs/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('not found');
    });

    test('Dealer is blocked from accessing audit detail endpoint (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/audit-logs/${testAuditLogId}`)
        .set('Authorization', `Bearer ${dealerToken}`);

      expect(res.status).toBe(403);
    });

    test('Unauthenticated request is rejected (401)', async () => {
      const res = await request(app)
        .get(`/api/v1/audit-logs/${testAuditLogId}`);

      expect(res.status).toBe(401);
    });
  });
});
