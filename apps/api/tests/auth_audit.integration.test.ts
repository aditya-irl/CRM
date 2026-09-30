import request from 'supertest';
import app from '../src/app';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, UserStatus } from '@crm/shared';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

describe('Comprehensive Authentication & Security Audit Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;
  let adminUserId: string;

  let testDealerId: string;
  let testDealerCode: string;
  let testDealerTempPassword: string;
  let testDealerToken: string;

  let disabledUserId: string;
  let disabledUserEmail: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;
    adminUserId = adminLogin.body.data.user.id;

    // 2. Create a test dealer and login account
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Auth Audit Store ${runId}`,
        ownerName: 'Audit Proprietor',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: '500 Audit Expressway',
        areaCity: 'Dadri',
      });
    expect(dealerRes.status).toBe(201);
    testDealerId = dealerRes.body.data.id;
    testDealerCode = dealerRes.body.data.dealerCode;

    const accountRes = await request(app)
      .post(`/api/v1/dealers/${testDealerId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(accountRes.status).toBe(201);
    testDealerTempPassword = accountRes.body.data.temporaryPassword;

    // 3. Create a disabled (INACTIVE) user directly in DB
    disabledUserId = uuidv4();
    disabledUserEmail = `disabled_${runId}@financecrm.test`;
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('DisabledPass@123', salt);
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        disabledUserId,
        disabledUserEmail,
        `99${Math.floor(10000000 + Math.random() * 90000000)}`,
        hash,
        'Disabled Test User',
        UserRole.COLLECTION_AGENT,
        UserStatus.INACTIVE,
      ]
    );
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Valid Admin Login
  test('1. Valid admin login succeeds and returns user and JWT tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('admin@financecrm.com');
    expect(res.body.data.user.role).toBe(UserRole.SUPER_ADMIN);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.tokens.refreshToken).toBeDefined();
    expect(res.body.data.tokens.expiresIn).toBe(900); // 15 mins
  });

  // 2. Invalid Password
  test('2. Invalid password returns 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'IncorrectPassword@999' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Invalid credentials');
  });

  // 3. Invalid Login ID
  test('3. Invalid login ID returns 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent_user@financecrm.com', password: 'Admin@123456' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Invalid credentials');
  });

  // 4. Disabled User Cannot Login
  test('4. Disabled / Inactive user cannot log in (returns 401 with inactive notice)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: disabledUserEmail, password: 'DisabledPass@123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('inactive');
  });

  // 5. Dealer Login
  test('5. Dealer login succeeds using Dealer Code and temporary password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testDealerCode, password: testDealerTempPassword });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    testDealerToken = res.body.data.tokens.accessToken;
  });

  // 6. Dealer Receives Correct Dealer Context
  test('6. Dealer receives DEALER role, linked dealerId, and mustChangePassword flag', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${testDealerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.role).toBe(UserRole.DEALER);
    expect(res.body.data.dealerId).toBe(testDealerId);
    expect(res.body.data.mustChangePassword).toBe(true);
  });

  // 7. Expired/Invalid Token Rejected
  test('7. Expired or forged JWT token is rejected with 401 Unauthorized', async () => {
    // Forged token
    const forgedRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer forged.invalid.token');
    expect(forgedRes.status).toBe(401);
    expect(forgedRes.body.error.message).toContain('Invalid or expired token');

    // Expired token signed with same secret but expired 1 minute ago
    const expiredToken = jwt.sign({ id: adminUserId }, JWT_SECRET, { expiresIn: '-1m' });
    const expiredRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.message).toContain('Invalid or expired token');
  });

  // 8. Protected API Rejects Unauthenticated Request
  test('8. Protected API rejects requests without Authorization header with 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('Missing or malformed Authorization header');
  });

  // 9. Logout Clears Session & Logs Audit Event
  test('9. Logout records immutable USER_LOGOUT audit event', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Logged out successfully');

    // Verify audit log entry
    const auditRes = await queryPostgres(
      `SELECT action, user_id FROM audit_logs WHERE user_id = $1 AND action = 'USER_LOGOUT' ORDER BY created_at DESC LIMIT 1`,
      [adminUserId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].action).toBe('USER_LOGOUT');
  });

  // 10. Forced Password-Change Flow Remains Functional
  test('10. Forced password-change flow allows dealer to change password and clears flag', async () => {
    const newPass = 'DealerNewPass@2026';
    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${testDealerToken}`)
      .send({
        currentPassword: testDealerTempPassword,
        newPassword: newPass,
      });

    expect(changeRes.status).toBe(200);
    expect(changeRes.body.success).toBe(true);

    // Verify flag is cleared on /auth/me
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${testDealerToken}`);
    expect(meRes.body.data.mustChangePassword).toBe(false);

    // Verify dealer can login with new password
    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testDealerCode, password: newPass });
    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.data.user.mustChangePassword).toBe(false);
  });

  // 11. Firebase Independence Check
  test('11. Authentication functions fully independently without Firebase dependencies or credentials', () => {
    // Confirm Firebase environment variables are not required for system operation
    expect(process.env.FIREBASE_API_KEY).toBeUndefined();
    expect(process.env.FIREBASE_PROJECT_ID).toBeUndefined();
    expect(process.env.VITE_FIREBASE_API_KEY).toBeUndefined();
  });

  // 12. No Credentials/Secrets Exposed in API Responses
  test('12. Passwords, password hashes, and JWT secrets are never exposed in API responses', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    const userObj = loginRes.body.data.user;
    expect(userObj.password).toBeUndefined();
    expect(userObj.password_hash).toBeUndefined();
    expect(userObj.passwordHash).toBeUndefined();
    expect(userObj.jwtSecret).toBeUndefined();

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.data.tokens.accessToken}`);

    const meUser = meRes.body.data;
    expect(meUser.password).toBeUndefined();
    expect(meUser.password_hash).toBeUndefined();
    expect(meUser.passwordHash).toBeUndefined();
  });
});
