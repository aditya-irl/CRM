import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { UserRole, LoanStatus, InterestMethod, RepaymentFrequency } from '@crm/shared';

describe('PHASE 2: Real Integration & Security Test Suite (PostgreSQL Loan Engine)', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  let adminToken: string;
  let agent1Token: string;
  let agent2Token: string;
  let agent1Id: string;
  let agent2Id: string;

  let customer1Id: string;
  let customer2Id: string;

  let activeLoan1Id: string;
  let activeLoan1AccountNo: string;
  let pendingLoanId: string;

  beforeAll(async () => {
    const numId = Date.now().toString().slice(-5);
    // 1. Create unique test users
    const adminEmail = `phase2_admin_${runId}@financecrm.com`;
    const agent1Email = `phase2_agent1_${runId}@financecrm.com`;
    const agent2Email = `phase2_agent2_${runId}@financecrm.com`;

    const adminHash = bcrypt.hashSync('password123', 10);

    // Direct seed admin
    const adminRes = await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, 'Phase 2 Admin', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [adminEmail, `987200${numId}1`, adminHash]
    );

    // Login as admin
    const adminLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'password123' });
    adminToken = adminLoginRes.body.data.tokens.accessToken;

    // Create Agent 1
    const agent1Create = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: agent1Email,
        phone: `987201${numId}2`,
        password: 'password123',
        fullName: `Phase 2 Agent 1 (${runId})`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent1Id = agent1Create.body.data.id;

    // Create Agent 2
    const agent2Create = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: agent2Email,
        phone: `987202${numId}3`,
        password: 'password123',
        fullName: `Phase 2 Agent 2 (${runId})`,
        role: UserRole.COLLECTION_AGENT,
      });
    agent2Id = agent2Create.body.data.id;

    // Login Agents
    const agent1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: agent1Email, password: 'password123' });
    agent1Token = agent1Login.body.data.tokens.accessToken;

    const agent2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: agent2Email, password: 'password123' });
    agent2Token = agent2Login.body.data.tokens.accessToken;

    // Create Customer 1 & Customer 2
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Rajesh Kumar ${runId}`,
        primaryPhone: `987211${numId}4`,
        addressLine1: '42 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        areaRoute: `ROUTE-P2-A-${runId}`,
      });
    customer1Id = c1Res.body.data.id;

    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Suresh Patel ${runId}`,
        primaryPhone: `987212${numId}5`,
        addressLine1: '88 Ring Road',
        city: 'Ahmedabad',
        state: 'Gujarat',
        pincode: '380015',
        areaRoute: `ROUTE-P2-B-${runId}`,
      });
    customer2Id = c2Res.body.data.id;

    // Assign Customer 1 to Agent 1, Customer 2 to Agent 2
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent1Id,
        customerId: customer1Id,
        effectiveFrom: '2026-01-01',
      });

    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agent2Id,
        customerId: customer2Id,
        effectiveFrom: '2026-01-01',
      });
  });

  afterAll(async () => {
    await closePostgresPool();
    await closeRedisConnection();
  });

  describe('1. Loan Calculation Preview Endpoint', () => {
    it('Calculates preview for Flat Rate with exact Banker rounding', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 50000,
          downPayment: 5000,
          annualInterestRate: 12,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-01-01',
          firstEmiDate: '2026-02-01',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.netDisbursedAmount).toBe(45000);
      expect(res.body.data.totalInterest).toBe(2700); // 45000 * 12% * 0.5 yr
      expect(res.body.data.totalPayable).toBe(47700);
      expect(res.body.data.totalInstallments).toBe(6);
      expect(res.body.data.schedule.length).toBe(6);

      // Verify exact sum equals total payable
      const sum = res.body.data.schedule.reduce((acc: number, curr: any) => acc + curr.expectedAmount, 0);
      expect(sum).toBe(47700);
    });

    it('Calculates preview for Reducing Balance amortization schedule', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${agent1Token}`) // Agents can also preview calculations
        .send({
          principalAmount: 100000,
          downPayment: 0,
          annualInterestRate: 14,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-01-01',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.schedule.length).toBe(12);
      expect(res.body.data.emiAmount).toBeGreaterThan(0);
    });
  });

  describe('2. Single-Step Loan Origination & Atomic EMI Schedule Generation (PostgreSQL)', () => {
    it('Admin books active loan for Customer 1 and generates all EMI installments in PostgreSQL', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer1Id,
          principalAmount: 60000,
          downPayment: 10000,
          annualInterestRate: 12,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-01-01',
          firstEmiDate: '2026-02-01',
          assignedAgentId: agent1Id,
          status: LoanStatus.ACTIVE,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.loanAccountNo).toMatch(/^LN-2026-/);
      expect(res.body.data.principalAmount).toBe(60000);
      expect(res.body.data.netDisbursedAmount).toBe(50000);
      expect(res.body.data.totalPayable).toBe(53000); // 50000 + (50000 * 12% * 0.5) = 53000
      expect(res.body.data.outstandingBalance).toBe(53000);
      expect(res.body.data.status).toBe('ACTIVE');

      activeLoan1Id = res.body.data.id;
      activeLoan1AccountNo = res.body.data.loanAccountNo;

      // Verify in real PostgreSQL database
      const loanPg = await queryPostgres('SELECT * FROM loans WHERE id = $1', [activeLoan1Id]);
      expect(loanPg.rows.length).toBe(1);
      expect(Number(loanPg.rows[0].total_payable)).toBe(53000.00);

      // Verify all 6 installments in PostgreSQL
      const emisPg = await queryPostgres(
        'SELECT * FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC',
        [activeLoan1Id]
      );
      expect(emisPg.rows.length).toBe(6);

      const totalExpected = emisPg.rows.reduce((sum, e) => sum + Number(e.expected_amount), 0);
      const totalPrincipal = emisPg.rows.reduce((sum, e) => sum + Number(e.principal_component), 0);
      expect(totalExpected).toBe(53000);
      expect(totalPrincipal).toBe(50000);
    });

    it('Rejects loan creation with invalid customer ID', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: '00000000-0000-0000-0000-000000000000',
          principalAmount: 50000,
          annualInterestRate: 12,
          tenureMonths: 6,
          disbursementDate: '2026-01-01',
        });

      expect(res.status).toBe(404);
    });

    it('Agent is forbidden from creating loans (RBAC)', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          customerId: customer1Id,
          principalAmount: 50000,
          annualInterestRate: 12,
          tenureMonths: 6,
          disbursementDate: '2026-01-01',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('3. Two-Step Loan Approval & Disbursement Workflow', () => {
    it('Creates loan in PENDING_APPROVAL status', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer2Id,
          principalAmount: 30000,
          downPayment: 0,
          annualInterestRate: 10,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 3,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-02-01',
          assignedAgentId: agent2Id,
          status: LoanStatus.PENDING_APPROVAL,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      pendingLoanId = res.body.data.id;
    });

    it('Admin approves loan (PENDING_APPROVAL -> APPROVED)', async () => {
      const res = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Credit verification cleared' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('APPROVED');

      const pgRes = await queryPostgres('SELECT status FROM loans WHERE id = $1', [pendingLoanId]);
      expect(pgRes.rows[0].status).toBe('APPROVED');
    });

    it('Admin disburses approved loan (APPROVED -> ACTIVE) and creates EMI schedule', async () => {
      const res = await request(app)
        .post(`/api/v1/loans/${pendingLoanId}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ disbursementDate: '2026-02-01' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ACTIVE');

      const emisPg = await queryPostgres('SELECT COUNT(*) as count FROM emi_installments WHERE loan_id = $1', [pendingLoanId]);
      expect(parseInt(emisPg.rows[0].count, 10)).toBe(3);
    });

    it('Rejection Workflow: Creates pending loan and rejects it with reason', async () => {
      const createRes = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: customer2Id,
          principalAmount: 80000,
          annualInterestRate: 15,
          tenureMonths: 6,
          disbursementDate: '2026-03-01',
          status: LoanStatus.PENDING_APPROVAL,
        });
      const rejectLoanId = createRes.body.data.id;

      const rejectRes = await request(app)
        .post(`/api/v1/loans/${rejectLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Insufficient customer income proof' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('REJECTED');

      const pgRes = await queryPostgres('SELECT status FROM loans WHERE id = $1', [rejectLoanId]);
      expect(pgRes.rows[0].status).toBe('REJECTED');
    });
  });

  describe('4. Row-Level Access Control (RLAC) & IDOR Defense for Loans', () => {
    it('Agent 1 can view details of Loan 1 (assigned to Customer 1)', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${activeLoan1Id}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(activeLoan1Id);
      expect(res.body.data.installments.length).toBe(6);
    });

    it('Agent 1 accessing Loan 2 (assigned to Customer 2 / Agent 2) is blocked with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${pendingLoanId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('access to this loan account');
    });

    it('Agent 1 loan list is strictly scoped to assigned portfolio (Loan 2 omitted)', async () => {
      const res = await request(app)
        .get('/api/v1/loans')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const loanIds = res.body.data.map((l: any) => l.id);
      expect(loanIds).toContain(activeLoan1Id);
      expect(loanIds).not.toContain(pendingLoanId);
    });
  });

  describe('5. Loan Listing, Search & Pagination', () => {
    it('Admin lists all loans with pagination metadata', async () => {
      const res = await request(app)
        .get('/api/v1/loans?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(5);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
    });

    it('Search by loan account number returns exact match', async () => {
      const res = await request(app)
        .get(`/api/v1/loans?search=${activeLoan1AccountNo}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(activeLoan1Id);
    });

    it('Filter by status=ACTIVE returns only active loans', async () => {
      const res = await request(app)
        .get('/api/v1/loans?status=ACTIVE')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.data.forEach((l: any) => {
        expect(l.status).toBe('ACTIVE');
      });
    });
  });

  describe('6. Immutable Audit Trail Integration for Loans', () => {
    it('Verifies audit records are generated for loan origination, approval, and rejection', async () => {
      const res = await request(app)
        .get('/api/v1/audit-logs?limit=50')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const actions = res.body.data.map((a: any) => a.action);
      expect(actions).toContain('LOAN_ORIGINATED');
      expect(actions).toContain('LOAN_APPROVED');
      expect(actions).toContain('LOAN_REJECTED');
      expect(actions).toContain('LOAN_DISBURSED');
    });
  });
});
