import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, DealerStatus, InterestMethod, RepaymentFrequency } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';

describe('Production Dealer Authentication & Backend RLAC Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;

  // Dealers
  let dealerAId: string;
  let dealerACode: string;
  let dealerATempPassword: string;
  let dealerAToken: string;
  let dealerAUserId: string;

  let dealerBId: string;
  let dealerBCode: string;
  let dealerBTempPassword: string;
  let dealerBToken: string;
  let dealerBUserId: string;

  // Customers & Loans for RLAC isolation testing
  let customerAId: string;
  let loanAId: string;
  let customerBId: string;
  let loanBId: string;

  beforeAll(async () => {
    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create Dealer A
    const dealerARes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Test Store Alpha ${runId}`,
        ownerName: 'Alpha Proprietor',
        phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `alpha_${runId}@store.test`,
        address: '101 Alpha Commercial Hub',
        areaCity: 'Dadri',
      });
    expect(dealerARes.status).toBe(201);
    dealerAId = dealerARes.body.data.id;
    dealerACode = dealerARes.body.data.dealerCode;

    // 3. Create Dealer B
    const dealerBRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Test Store Beta ${runId}`,
        ownerName: 'Beta Proprietor',
        phone: `99${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `beta_${runId}@store.test`,
        address: '202 Beta Commercial Arcade',
        areaCity: 'Noida',
      });
    expect(dealerBRes.status).toBe(201);
    dealerBId = dealerBRes.body.data.id;
    dealerBCode = dealerBRes.body.data.dealerCode;

    // 4. Create Customer A & Loan A linked to Dealer A
    customerAId = uuidv4();
    const custACode = `CUST-A-${runId}`;
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customerAId, custACode, `Customer Alpha ${runId}`, `910${Math.floor(1000000 + Math.random() * 9000000)}`, 'A Street', 'Dadri', 'UP', '203207', 'Route-A']
    );

    loanAId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date)
       VALUES ($1, $2, $3, $4, 15000, 2000, 13000, 12.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 2500, 2000, 15000, 0, 15000, 'ACTIVE', CURRENT_DATE,
               CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months')`,
      [loanAId, `LA-A-${runId}`, customerAId, dealerAId]
    );

    // 5. Create Customer B & Loan B linked to Dealer B
    customerBId = uuidv4();
    const custBCode = `CUST-B-${runId}`;
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [customerBId, custBCode, `Customer Beta ${runId}`, `920${Math.floor(1000000 + Math.random() * 9000000)}`, 'B Street', 'Noida', 'UP', '201301', 'Route-B']
    );

    loanBId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date)
       VALUES ($1, $2, $3, $4, 20000, 3000, 17000, 14.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 3500, 3000, 21000, 0, 21000, 'ACTIVE', CURRENT_DATE,
               CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months')`,
      [loanBId, `LA-B-${runId}`, customerBId, dealerBId]
    );
  });

  afterAll(async () => {
    // Cleanup created test records
    if (loanAId) await queryPostgres('DELETE FROM loans WHERE id = $1', [loanAId]);
    if (loanBId) await queryPostgres('DELETE FROM loans WHERE id = $1', [loanBId]);
    if (customerAId) await queryPostgres('DELETE FROM customers WHERE id = $1', [customerAId]);
    if (customerBId) await queryPostgres('DELETE FROM customers WHERE id = $1', [customerBId]);
    // Soft-deactivate test dealer users & dealers to avoid immutable audit log FK violations
    if (dealerAUserId) await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [dealerAUserId]);
    if (dealerBUserId) await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [dealerBUserId]);
    if (dealerAId) await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id = $1", [dealerAId]);
    if (dealerBId) await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id = $1", [dealerBId]);

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // Test 1: Admin creates dealer login
  it('1. Admin can create a login account for Dealer A and Dealer B', async () => {
    const resA = await request(app)
      .post(`/api/v1/dealers/${dealerAId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resA.status).toBe(201);
    expect(resA.body.success).toBe(true);
    expect(resA.body.data.dealerId).toBe(dealerAId);
    expect(resA.body.data.loginId).toBe(dealerACode);
    expect(typeof resA.body.data.temporaryPassword).toBe('string');
    expect(resA.body.data.temporaryPassword.length).toBeGreaterThan(8);
    dealerATempPassword = resA.body.data.temporaryPassword;

    // Verify linked user account
    const userRes = await queryPostgres('SELECT id, role, dealer_id FROM users WHERE dealer_id = $1', [dealerAId]);
    expect(userRes.rows.length).toBe(1);
    expect(userRes.rows[0].role).toBe(UserRole.DEALER);
    dealerAUserId = userRes.rows[0].id;

    // Create Dealer B account
    const resB = await request(app)
      .post(`/api/v1/dealers/${dealerBId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resB.status).toBe(201);
    expect(resB.body.success).toBe(true);
    dealerBTempPassword = resB.body.data.temporaryPassword;
    const userBRes = await queryPostgres('SELECT id FROM users WHERE dealer_id = $1', [dealerBId]);
    dealerBUserId = userBRes.rows[0].id;
  });

  // Test 16: Duplicate dealer login IDs are prevented
  it('16. Duplicate dealer login account creation is prevented', async () => {
    const dupRes = await request(app)
      .post(`/api/v1/dealers/${dealerAId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(dupRes.status).toBe(400);
    expect(dupRes.body.success).toBe(false);
  });

  // Test 2: Dealer login succeeds with valid credentials
  it('2. Dealer login succeeds with valid credentials (using Dealer Code as Login ID)', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerACode, password: dealerATempPassword });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.user.role).toBe(UserRole.DEALER);
    expect(loginRes.body.data.user.dealerId).toBe(dealerAId);
    expect(loginRes.body.data.tokens.accessToken).toBeDefined();

    dealerAToken = loginRes.body.data.tokens.accessToken;

    // Also login as Dealer B
    const loginBRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerBCode, password: dealerBTempPassword });

    expect(loginBRes.status).toBe(200);
    dealerBToken = loginBRes.body.data.tokens.accessToken;
  });

  // Test 3: Dealer login fails with incorrect password
  it('3. Dealer login fails with incorrect password', async () => {
    const failRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerACode, password: 'WrongPassword@999' });

    expect(failRes.status).toBe(401);
    expect(failRes.body.success).toBe(false);
  });

  // Test 4: Disabled dealer cannot log in
  it('4. Disabled dealer cannot log in', async () => {
    // Disable Dealer A login status
    const disableRes = await request(app)
      .patch(`/api/v1/dealers/${dealerAId}/login-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' });

    expect(disableRes.status).toBe(200);

    // Try to login as disabled dealer
    const blockedLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerACode, password: dealerATempPassword });

    expect(blockedLogin.status).toBe(401);
    expect(blockedLogin.body.error.message).toMatch(/inactive/i);

    // Re-enable Dealer A login
    await request(app)
      .patch(`/api/v1/dealers/${dealerAId}/login-status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' });
  });

  // Test 5: Dealer JWT contains correct role/dealer context
  it('5. Dealer JWT contains correct role and dealer context', () => {
    const decoded = jwt.verify(dealerAToken, JWT_SECRET) as any;
    expect(decoded.role).toBe(UserRole.DEALER);
    expect(decoded.dealerId).toBe(dealerAId);
  });

  // Test 6: Dealer can access dealer dashboard APIs
  it('6. Dealer can access dealer dashboard APIs', async () => {
    const dashRes = await request(app)
      .get('/api/v1/dealers/dashboard')
      .set('Authorization', `Bearer ${dealerAToken}`);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.success).toBe(true);
    expect(dashRes.body.data.dealer.id).toBe(dealerAId);
    expect(dashRes.body.data.metrics.totalCustomers).toBe(1);
    expect(dashRes.body.data.metrics.activeLoans).toBe(1);
    expect(dashRes.body.data.metrics.totalFinancedAmount).toBe(15000);
  });

  // Test 7: Dealer can access their own dealer profile
  it('7. Dealer can access their own dealer profile via /dealers/me and /dealers/:id', async () => {
    const meRes = await request(app)
      .get('/api/v1/dealers/me')
      .set('Authorization', `Bearer ${dealerAToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.dealer.id).toBe(dealerAId);

    const idRes = await request(app)
      .get(`/api/v1/dealers/${dealerAId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);

    expect(idRes.status).toBe(200);
    expect(idRes.body.data.dealer.id).toBe(dealerAId);
  });

  // Test 8: Dealer cannot access another dealer's data
  it('8. Dealer cannot access another dealer data (Dealer A accessing Dealer B returns 403)', async () => {
    const forbiddenRes = await request(app)
      .get(`/api/v1/dealers/${dealerBId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);

    expect(forbiddenRes.status).toBe(403);
  });

  // Test 9: Dealer cannot access admin endpoints
  it('9. Dealer cannot access admin endpoints (/reports/finance-dashboard, /users, /audit-logs return 403)', async () => {
    const reportRes = await request(app)
      .get('/api/v1/reports/finance-dashboard')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(reportRes.status).toBe(403);

    const usersRes = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(usersRes.status).toBe(403);

    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(auditRes.status).toBe(403);
  });

  // Test 10: Dealer cannot access another dealer's customers
  it('10. Dealer cannot access another dealer customers (RLAC IDOR protection)', async () => {
    // Dealer A attempting to get Customer B by ID
    const custBRes = await request(app)
      .get(`/api/v1/customers/${customerBId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(custBRes.status).toBe(403);

    // Dealer A listing customers only sees Customer A
    const listCustRes = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(listCustRes.status).toBe(200);
    const customerIds = listCustRes.body.data.map((c: any) => c.id);
    expect(customerIds).toContain(customerAId);
    expect(customerIds).not.toContain(customerBId);

    // Dealer A attempting to query with another dealer's query param is strictly ignored/scoped
    const tamperedCust = await request(app)
      .get(`/api/v1/customers?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(tamperedCust.status).toBe(200);
    const tamperedIds = tamperedCust.body.data.map((c: any) => c.id);
    expect(tamperedIds).not.toContain(customerBId);
  });

  // Test 11: Dealer cannot access another dealer's loans
  it('11. Dealer cannot access another dealer loans (RLAC IDOR protection)', async () => {
    // Dealer A attempting to get Loan B by ID
    const loanBRes = await request(app)
      .get(`/api/v1/loans/${loanBId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(loanBRes.status).toBe(403);

    // Dealer A listing loans only sees Loan A
    const listLoansRes = await request(app)
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(listLoansRes.status).toBe(200);
    const loanIds = listLoansRes.body.data.map((l: any) => l.id);
    expect(loanIds).toContain(loanAId);
    expect(loanIds).not.toContain(loanBId);

    // Dealer A attempting to pass dealerId=dealerBId in query parameters
    const tamperedLoans = await request(app)
      .get(`/api/v1/loans?dealerId=${dealerBId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(tamperedLoans.status).toBe(200);
    const tamperedLoanIds = tamperedLoans.body.data.map((l: any) => l.id);
    expect(tamperedLoanIds).not.toContain(loanBId);
  });

  // Test 12: Existing admin login still works
  it('12. Existing admin login still works', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe(UserRole.SUPER_ADMIN);
  });

  // Test 13: Existing manager login still works
  it('13. Existing manager login still works', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'manager@financecrm.com', password: 'Admin@123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe(UserRole.BRANCH_MANAGER);
  });

  // Test 14: Existing field agent login still works
  it('14. Existing field agent login still works', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'agent.rahul@financecrm.com', password: 'Agent@123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe(UserRole.COLLECTION_AGENT);
  });

  // Test 17: Password is never returned by normal API responses
  it('17. Password and password hash are NEVER exposed by normal API responses', async () => {
    // Current user profile
    const profileRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(profileRes.status).toBe(200);
    expect(profileRes.body.data.password).toBeUndefined();
    expect(profileRes.body.data.password_hash).toBeUndefined();
    expect(profileRes.body.data.passwordHash).toBeUndefined();

    // Dealer profile
    const dealerRes = await request(app)
      .get(`/api/v1/dealers/${dealerAId}`)
      .set('Authorization', `Bearer ${dealerAToken}`);
    expect(dealerRes.status).toBe(200);
    const jsonStr = JSON.stringify(dealerRes.body);
    expect(jsonStr).not.toContain(dealerATempPassword);
    expect(jsonStr).not.toContain('password_hash');
  });

  // Test 18: Password is never written to logs
  it('18. Password is NEVER written to audit logs', async () => {
    const auditRes = await queryPostgres(
      `SELECT new_state, previous_state FROM audit_logs 
       WHERE entity = 'Dealer' AND entity_id = $1`,
      [dealerAId]
    );

    for (const row of auditRes.rows) {
      const stateStr = JSON.stringify(row);
      expect(stateStr).not.toContain(dealerATempPassword);
      expect(stateStr).not.toContain('password');
    }
  });
});
