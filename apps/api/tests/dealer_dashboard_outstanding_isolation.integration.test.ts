import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { UserRole } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';

describe('Dealer Dashboard: Active Outstanding Metric Isolation (Regression Tests)', () => {
  const runId = Math.random().toString(36).substring(2, 7);

  let adminId: string;
  let adminToken: string;

  let branchManagerId: string;
  let branchManagerToken: string;

  let dealerId: string;
  let dealerUserId: string;
  let dealerToken: string;

  let customerId: string;
  let loanId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Admin
    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ADMIN', 'Dashboard Admin', 'ACTIVE', NOW(), NOW())`,
      [adminId, `dash_admin_${runId}@crm.test`, hash]
    );
    adminToken = jwt.sign({ id: adminId }, JWT_SECRET, { expiresIn: '1h' });

    // 2. Branch Manager
    branchManagerId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, assigned_branch, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'BRANCH_MANAGER', 'Dashboard BM', 'North Zone', 'ACTIVE', NOW(), NOW())`,
      [branchManagerId, `dash_bm_${runId}@crm.test`, hash]
    );
    branchManagerToken = jwt.sign({ id: branchManagerId }, JWT_SECRET, { expiresIn: '1h' });

    // 3. Dealer & Dealer User
    dealerId = uuidv4();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, 'Galaxy Mobile Hub', 'Ramesh Kumar', $3, $4, 'ACTIVE', 'North Zone', 'Shop 42 Market', NOW(), NOW())`,
      [dealerId, `DLR_DASH_${runId}`, `9876${Date.now().toString().slice(-6)}`, `dealer_${runId}@store.test`]
    );

    dealerUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, role, full_name, status, dealer_id, assigned_branch, created_at, updated_at)
       VALUES ($1, $2, $3, 'DEALER', 'Store Partner Ramesh', 'ACTIVE', $4, 'North Zone', NOW(), NOW())`,
      [dealerUserId, `dlr_user_${runId}@store.test`, hash, dealerId]
    );
    dealerToken = jwt.sign({ id: dealerUserId }, JWT_SECRET, { expiresIn: '1h' });

    // 4. Customer and Active Loan with Outstanding Balance
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Aakash Verma', $3, 'Civil Lines', 'North Zone', 'UP', '201301', 'Route 1', $4, NOW(), NOW())`,
      [customerId, `CUST_D_${runId}`, `9811${Date.now().toString().slice(-6)}`, dealerUserId]
    );

    loanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment,
        net_disbursed_amount, annual_interest_rate, interest_calc_method, tenure_months,
        installment_frequency, total_installments, emi_amount, total_interest, total_payable,
        total_paid, outstanding_balance, status, disbursement_date, first_emi_date, maturity_date,
        device_brand, device_model
      ) VALUES (
        $1, $2, $3, $4, 25000, 3000, 22000, 14.00, 'FLAT_RATE', 6, 'MONTHLY', 6,
        4180, 3080, 25080, 4180, 20900, 'ACTIVE', CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months',
        'OnePlus', 'Nord CE 4'
      )`,
      [loanId, `LN_DASH_${runId}`, customerId, dealerId]
    );
  });

  afterAll(async () => {
    await queryPostgres('DELETE FROM loans WHERE id = $1', [loanId]);
    await queryPostgres('DELETE FROM customers WHERE id = $1', [customerId]);
    await queryPostgres('DELETE FROM users WHERE id IN ($1, $2, $3)', [adminId, branchManagerId, dealerUserId]);
    await queryPostgres('DELETE FROM dealers WHERE id = $1', [dealerId]);
  });

  it('1. Dealer GET /api/v1/dealers/dashboard does NOT expose totalOutstandingBalance', async () => {
    const res = await request(app)
      .get('/api/v1/dealers/dashboard')
      .set('Authorization', `Bearer ${dealerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const metrics = res.body.data.metrics;
    expect(metrics).toBeDefined();

    // Sensitive aggregate active outstanding balance MUST NOT be exposed to dealer
    expect(metrics.totalOutstandingBalance).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(metrics, 'totalOutstandingBalance')).toBe(false);

    // Other dealer metrics remain present and accurate
    expect(metrics.totalCustomers).toBe(1);
    expect(metrics.activeLoans).toBe(1);
    expect(metrics.totalFinancedAmount).toBe(25000);
    expect(typeof metrics.totalCollectedAmount).toBe('number');
    expect(typeof metrics.unsettledCollectionAmount).toBe('number');

    // Individual recent loan data and operational fields remain intact
    expect(Array.isArray(res.body.data.recentLoans)).toBe(true);
    expect(res.body.data.recentLoans.length).toBe(1);
    expect(res.body.data.recentLoans[0].id).toBe(loanId);
    expect(res.body.data.recentLoans[0].outstandingBalance).toBe(20900);
  });

  it('2. Admin GET /api/v1/dealers/dashboard?dealerId=... preserves totalOutstandingBalance', async () => {
    const res = await request(app)
      .get(`/api/v1/dealers/dashboard?dealerId=${dealerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const metrics = res.body.data.metrics;
    expect(metrics).toBeDefined();

    // Authorized management roles MUST still receive totalOutstandingBalance
    expect(metrics.totalOutstandingBalance).toBeDefined();
    expect(typeof metrics.totalOutstandingBalance).toBe('number');
    expect(metrics.totalOutstandingBalance).toBe(20900);
  });

  it('3. Branch Manager GET /api/v1/dealers/dashboard?dealerId=... preserves totalOutstandingBalance', async () => {
    const res = await request(app)
      .get(`/api/v1/dealers/dashboard?dealerId=${dealerId}`)
      .set('Authorization', `Bearer ${branchManagerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const metrics = res.body.data.metrics;
    expect(metrics.totalOutstandingBalance).toBeDefined();
    expect(metrics.totalOutstandingBalance).toBe(20900);
  });

  it('4. Management role without dealerId parameter returns 400 Bad Request', async () => {
    const res = await request(app)
      .get('/api/v1/dealers/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);

    expect([400, 422]).toContain(res.status);
  });

  it('5. Unauthenticated request to /api/v1/dealers/dashboard returns 401', async () => {
    const res = await request(app).get('/api/v1/dealers/dashboard');
    expect(res.status).toBe(401);
  });
});
