import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, DealerStatus, InterestMethod, RepaymentFrequency } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Dealer & Mobile Store Management Integration Tests', () => {
  const runId = Date.now().toString(36);
  const adminEmail = `admin_${runId}@dealertest.com`;
  const managerEmail = `mgr_${runId}@dealertest.com`;
  const agentEmail = `agent_${runId}@dealertest.com`;

  let adminToken: string;
  let managerToken: string;
  let agentToken: string;
  let adminId: string;
  let managerId: string;
  let agentId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('DealerTest@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agentId = uuidv4();

    // Create Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Dealer Admin', 'ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `+919${Date.now().toString().slice(-9)}`, hash]);

    // Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Dealer Manager', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `+918${Date.now().toString().slice(-9)}`, hash]);

    // Create Collection Agent
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Dealer Agent', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agentId, agentEmail, `+917${Date.now().toString().slice(-9)}`, hash]);

    // Logins
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'DealerTest@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'DealerTest@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agentLogin = await request(app).post('/api/v1/auth/login').send({ email: agentEmail, password: 'DealerTest@123' });
    agentToken = agentLogin.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  let createdDealerId: string;
  let createdDealerCode: string;

  it('1. Admin can create a new dealer with unique sequential code and audit log', async () => {
    const res = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: 'Rathore Mobile - Dadri',
        ownerName: 'Rakesh Kumar',
        phone: '9876543210',
        alternatePhone: '9876543211',
        email: 'rathore.dadri@example.com',
        address: 'Main Market, Railway Road',
        areaCity: 'Dadri',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.dealerCode).toMatch(/^DLR-\d{6}$/);
    expect(res.body.data.storeName).toBe('Rathore Mobile - Dadri');
    expect(res.body.data.status).toBe(DealerStatus.ACTIVE);

    createdDealerId = res.body.data.id;
    createdDealerCode = res.body.data.dealerCode;

    // Verify audit log
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'Dealer' AND entity_id = $1 AND action = 'DEALER_CREATED'`,
      [createdDealerId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].new_state.storeName).toBe('Rathore Mobile - Dadri');
  });

  it('2. Branch Manager can create a dealer', async () => {
    const res = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        storeName: 'Sharma Telecom - Alpha 1',
        ownerName: 'Anil Sharma',
        phone: '9812345678',
        address: 'Shop 12, Commercial Belt',
        areaCity: 'Alpha 1',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.storeName).toBe('Sharma Telecom - Alpha 1');
  });

  it('3. Collection Agent cannot create or modify dealers (403 Forbidden)', async () => {
    const createRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        storeName: 'Unauthorized Store',
        ownerName: 'Test',
        phone: '9800000000',
        address: 'Test Address',
        areaCity: 'Dadri',
      });

    expect(createRes.status).toBe(403);

    const updateRes = await request(app)
      .patch(`/api/v1/dealers/${createdDealerId}`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ storeName: 'Hacked Store' });

    expect(updateRes.status).toBe(403);
  });

  it('4. Validates required dealer fields', async () => {
    const res = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: '',
        ownerName: 'Test',
        phone: 'invalid-phone',
        address: 'Short',
        areaCity: '',
      });

    expect([400, 422]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('5. Admin/Manager can edit dealer information', async () => {
    const res = await request(app)
      .patch(`/api/v1/dealers/${createdDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ownerName: 'Rakesh Kumar Rathore',
        phone: '9876543299',
        address: 'Updated Main Market, Shop 45',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.ownerName).toBe('Rakesh Kumar Rathore');
    expect(res.body.data.phone).toBe('9876543299');
    expect(res.body.data.address).toBe('Updated Main Market, Shop 45');

    // Verify audit log
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'Dealer' AND entity_id = $1 AND action = 'DEALER_UPDATED'`,
      [createdDealerId]
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('6. Admin can deactivate dealer (DEALER_DEACTIVATED)', async () => {
    const res = await request(app)
      .patch(`/api/v1/dealers/${createdDealerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: DealerStatus.INACTIVE });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe(DealerStatus.INACTIVE);

    // Verify audit log
    const auditRes = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'Dealer' AND entity_id = $1 AND action = 'DEALER_DEACTIVATED'`,
      [createdDealerId]
    );
    expect(auditRes.rows.length).toBe(1);
  });

  it('7. Inactive dealer cannot be selected for new loans (400 Bad Request)', async () => {
    // Create a customer first
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Vikram Singh',
        primaryPhone: `+919${Date.now().toString().slice(-9)}`,
        addressLine1: 'H-12, Sector 1',
        city: 'Dadri',
        state: 'Uttar Pradesh',
        pincode: '203207',
        areaRoute: 'Dadri',
      });

    expect(custRes.status).toBe(201);
    const customerId = custRes.body.data.id;

    // Attempt to book loan with inactive dealer
    const loanRes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId: createdDealerId,
        principalAmount: 25000,
        downPayment: 5000,
        annualInterestRate: 14,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: new Date().toISOString().split('T')[0],
      });

    expect(loanRes.status).toBe(400);
    expect(loanRes.body.success).toBe(false);
    expect(loanRes.body.error.message).toContain('inactive');
  });

  it('8. Admin can reactivate dealer and link to a new loan successfully', async () => {
    // Reactivate dealer
    const reactivateRes = await request(app)
      .patch(`/api/v1/dealers/${createdDealerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: DealerStatus.ACTIVE });

    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.data.status).toBe(DealerStatus.ACTIVE);

    // Create customer
    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Manish Tyagi',
        primaryPhone: `+919${Date.now().toString().slice(-9)}`,
        addressLine1: 'Block C, Dadri',
        city: 'Dadri',
        state: 'Uttar Pradesh',
        pincode: '203207',
        areaRoute: 'Dadri',
      });
    const customerId = custRes.body.data.id;

    // Book loan with activated dealer
    const loanRes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        dealerId: createdDealerId,
        principalAmount: 30000,
        downPayment: 6000,
        annualInterestRate: 15,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: new Date().toISOString().split('T')[0],
      });

    expect(loanRes.status).toBe(201);
    expect(loanRes.body.success).toBe(true);
    expect(loanRes.body.data.dealerId).toBe(createdDealerId);
    expect(loanRes.body.data.dealerStoreName).toBe('Rathore Mobile - Dadri');
    expect(loanRes.body.data.dealerCode).toBe(createdDealerCode);

    const loanId = loanRes.body.data.id;

    // Verify GET /api/v1/loans/:id returns dealer info
    const getLoanRes = await request(app)
      .get(`/api/v1/loans/${loanId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getLoanRes.status).toBe(200);
    expect(getLoanRes.body.data.dealerId).toBe(createdDealerId);
    expect(getLoanRes.body.data.dealerStoreName).toBe('Rathore Mobile - Dadri');
    expect(getLoanRes.body.data.dealerCode).toBe(createdDealerCode);

    // Verify GET /api/v1/customers/:id returns loan with dealer info
    const getCustRes = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(getCustRes.status).toBe(200);
    expect(getCustRes.body.data.loans[0].dealerId).toBe(createdDealerId);
    expect(getCustRes.body.data.loans[0].dealerStoreName).toBe('Rathore Mobile - Dadri');
    expect(getCustRes.body.data.loans[0].dealerCode).toBe(createdDealerCode);
  });

  it('9. Existing loan remains valid and readable even if its dealer is later deactivated', async () => {
    // Deactivate dealer again
    await request(app)
      .patch(`/api/v1/dealers/${createdDealerId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: DealerStatus.INACTIVE });

    // Verify dealer is inactive
    const dealerRes = await request(app)
      .get(`/api/v1/dealers/${createdDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dealerRes.body.data.dealer.status).toBe(DealerStatus.INACTIVE);
    expect(dealerRes.body.data.dealer.activeLoansCount).toBeGreaterThanOrEqual(1);

    // Query loans - historical loan should still have dealer store name & code
    const loansListRes = await request(app)
      .get(`/api/v1/loans?dealerId=${createdDealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(loansListRes.status).toBe(200);
    expect(loansListRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(loansListRes.body.data[0].dealerStoreName).toBe('Rathore Mobile - Dadri');
  });

  it('10. Dealer listing supports search, status filter, and pagination', async () => {
    const listRes = await request(app)
      .get('/api/v1/dealers?search=Sharma&status=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.success).toBe(true);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(listRes.body.data[0].storeName).toContain('Sharma Telecom');
  });

  // ─── COLLECTION_AGENT Dealer Authorization & Projection ───────────────────

  it('11. COLLECTION_AGENT GET /dealers returns 200 with only minimum safe fields', async () => {
    const res = await request(app)
      .get('/api/v1/dealers?status=ACTIVE&limit=10')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    // Each item must have the fields required for the payment-source dropdown
    for (const dealer of res.body.data) {
      expect(dealer).toHaveProperty('id');
      expect(dealer).toHaveProperty('storeName');
      expect(dealer).toHaveProperty('dealerCode');
      expect(dealer).toHaveProperty('areaCity');
      expect(dealer).toHaveProperty('status');

      // Must NOT contain PII or account-management fields
      expect(dealer).not.toHaveProperty('phone');
      expect(dealer).not.toHaveProperty('alternatePhone');
      expect(dealer).not.toHaveProperty('email');
      expect(dealer).not.toHaveProperty('userId');
      expect(dealer).not.toHaveProperty('userLoginId');
      expect(dealer).not.toHaveProperty('userStatus');
      expect(dealer).not.toHaveProperty('mustChangePassword');
      expect(dealer).not.toHaveProperty('address');
      expect(dealer).not.toHaveProperty('ownerName');
      expect(dealer).not.toHaveProperty('activeLoansCount');
      expect(dealer).not.toHaveProperty('closedLoansCount');
      expect(dealer).not.toHaveProperty('totalCustomersCount');
    }
  });

  it('12. COLLECTION_AGENT GET /dealers/:id returns 403 Forbidden', async () => {
    // Own dealer (uses the dealer created in test 1)
    const res = await request(app)
      .get(`/api/v1/dealers/${createdDealerId}`)
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);

    // Also verify with a non-existent dealer ID — must still 403 (auth checked before lookup)
    const randomId = '00000000-0000-0000-0000-000000000000';
    const res2 = await request(app)
      .get(`/api/v1/dealers/${randomId}`)
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res2.status).toBe(403);
  });

  it('13. Admin GET /dealers retains full dealer-management response', async () => {
    const res = await request(app)
      .get('/api/v1/dealers?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const sample = res.body.data[0];
    // Admin must still receive all management fields
    expect(sample).toHaveProperty('phone');
    expect(sample).toHaveProperty('email');
    expect(sample).toHaveProperty('userId');
    expect(sample).toHaveProperty('userLoginId');
    expect(sample).toHaveProperty('userStatus');
    expect(sample).toHaveProperty('mustChangePassword');
    expect(sample).toHaveProperty('activeLoansCount');
    expect(sample).toHaveProperty('closedLoansCount');
    expect(sample).toHaveProperty('totalCustomersCount');
    expect(sample).toHaveProperty('ownerName');
    expect(sample).toHaveProperty('address');
  });
});
