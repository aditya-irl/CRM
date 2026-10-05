import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, getBusinessDate, addDays, EMIStatus } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Dynamic EMI Overdue Derivation (Without BullMQ Worker)', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-5);
  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

  let superAdminToken: string;
  let agentToken: string;
  let superAdminId: string;
  let agentId: string;
  let customerId: string;
  let loanId: string;
  let loanAccountNo: string;
  let portalToken: string;

  let futureEmiId: string;
  let dueTodayEmiId: string;
  let overdueEmiId: string;
  let paidEmiId: string;
  let overdueWithPenaltyEmiId: string;
  let overduePartialEmiId: string;

  beforeAll(async () => {
    // 1. Create Super Admin and Agent
    superAdminId = uuidv4();
    agentId = uuidv4();
    const passwordHash = await bcrypt.hash('Password123!', 10);

    await queryPostgres(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
       VALUES 
       ($1, $2, $3, 'Super Admin Dynamic', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW()),
       ($4, $5, $3, 'Agent Dynamic', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId,
        `sa_dyn_${runId}@crm.test`,
        passwordHash,
        agentId,
        `agent_dyn_${runId}@crm.test`,
      ]
    );

    // Login Super Admin
    const saLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `sa_dyn_${runId}@crm.test`, password: 'Password123!' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    // Login Agent
    const agLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: `agent_dyn_${runId}@crm.test`, password: 'Password123!' });
    agentToken = agLogin.body.data.tokens.accessToken;

    // 2. Create Customer
    customerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'MG Road', 'Bengaluru', 'Karnataka', '560001', $5, TRUE, $6, NOW(), NOW())`,
      [
        customerId,
        `CUST-DYN-${runId}`,
        `Dynamic Test Customer ${runId}`,
        `+9198111${numId}`,
        `ROUTE-${runId}`,
        superAdminId,
      ]
    );

    // 3. Create Loan
    loanId = uuidv4();
    loanAccountNo = `LN-DYN-${runId}`;
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date, status,
        assigned_agent_id, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 60000.00, 0.00, 60000.00,
        0.1200, 'FLAT_RATE', 6, 'MONTHLY',
        6, 10000.00, 0.00, 60000.00, 10000.00,
        50000.00, $4, $5, $6, 'ACTIVE',
        $7, $8, NOW(), NOW()
      )`,
      [
        loanId,
        loanAccountNo,
        customerId,
        addDays(businessToday, -60),
        addDays(businessToday, -30),
        addDays(businessToday, 120),
        agentId,
        superAdminId,
      ]
    );

    // 4. Create installments with deliberate STALE database statuses to test dynamic derivation:
    // Notice: BullMQ worker is NOT running, so in the database they were inserted with status='UPCOMING' and days_overdue=0!
    
    // Inst 1: Overdue by 15 days, but DB has status='UPCOMING' and days_overdue=0
    overdueEmiId = uuidv4();
    const overdueDate = addDays(businessToday, -15);
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 1, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [overdueEmiId, loanId, customerId, overdueDate]
    );

    // Inst 2: Overdue with penalty (due 10 days ago, DB status='UPCOMING', days_overdue=0, penalty=500.00)
    overdueWithPenaltyEmiId = uuidv4();
    const overduePenaltyDate = addDays(businessToday, -10);
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 2, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 500.00, 'UPCOMING', 0, NOW(), NOW())`,
      [overdueWithPenaltyEmiId, loanId, customerId, overduePenaltyDate]
    );

    // Inst 3: Overdue with partial payment (due 5 days ago, paid 3000, remaining 7000, DB status='UPCOMING', days_overdue=0)
    overduePartialEmiId = uuidv4();
    const overduePartialDate = addDays(businessToday, -5);
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 3, $4, 10000.00, 0.00, 10000.00, 3000.00, 7000.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [overduePartialEmiId, loanId, customerId, overduePartialDate]
    );

    // Inst 4: Due Today (due today, DB status='UPCOMING', days_overdue=0)
    dueTodayEmiId = uuidv4();
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 4, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [dueTodayEmiId, loanId, customerId, businessToday]
    );

    // Inst 5: Future EMI (due in 30 days, DB status='UPCOMING', days_overdue=0)
    futureEmiId = uuidv4();
    const futureDate = addDays(businessToday, 30);
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 5, $4, 10000.00, 0.00, 10000.00, 0.00, 10000.00, 0.00, 'UPCOMING', 0, NOW(), NOW())`,
      [futureEmiId, loanId, customerId, futureDate]
    );

    // Inst 6: Paid EMI (due 45 days ago, paid 10000, remaining 0, status='PAID')
    paidEmiId = uuidv4();
    const paidDate = addDays(businessToday, -45);
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, days_overdue, created_at, updated_at
      ) VALUES ($1, $2, $3, 6, $4, 10000.00, 0.00, 10000.00, 10000.00, 0.00, 0.00, 'PAID', 0, NOW(), NOW())`,
      [paidEmiId, loanId, customerId, paidDate]
    );

    // 5. Generate Portal Link
    const linkRes = await request(app)
      .post(`/api/v1/portal/loans/${loanId}/link`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    portalToken = linkRes.body.data.token;
  });

  describe('1. Customer Portal Dynamic Derivation', () => {
    it('accurately derives OVERDUE, DUE_TODAY, UPCOMING, and PAID states without worker execution', async () => {
      const res = await request(app)
        .get(`/api/v1/portal/loan?token=${portalToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.overdueInstallments).toBe(3); // overdue 1, overdue with penalty 2, overdue partial 3
      expect(data.paidInstallments).toBe(1);

      const instMap = new Map(data.installments.map((i: any) => [i.installmentNumber, i]));

      // Inst 1: Overdue by 15 days
      const i1: any = instMap.get(1);
      expect(i1.status).toBe('OVERDUE');
      expect(i1.daysOverdue).toBe(15);
      expect(i1.totalDue).toBe(10000.00);

      // Inst 2: Overdue by 10 days with penalty
      const i2: any = instMap.get(2);
      expect(i2.status).toBe('OVERDUE');
      expect(i2.daysOverdue).toBe(10);
      expect(i2.penaltyAmount).toBe(500.00);
      expect(i2.totalDue).toBe(10500.00);

      // Inst 3: Overdue by 5 days with partial payment
      const i3: any = instMap.get(3);
      expect(i3.status).toBe('OVERDUE');
      expect(i3.daysOverdue).toBe(5);
      expect(i3.paidAmount).toBe(3000.00);
      expect(i3.remainingAmount).toBe(7000.00);
      expect(i3.totalDue).toBe(7000.00);

      // Inst 4: Due Today
      const i4: any = instMap.get(4);
      expect(i4.status).toBe('DUE_TODAY');
      expect(i4.daysOverdue).toBe(0);

      // Inst 5: Future EMI
      const i5: any = instMap.get(5);
      expect(i5.status).toBe('UPCOMING');
      expect(i5.daysOverdue).toBe(0);

      // Inst 6: Paid EMI
      const i6: any = instMap.get(6);
      expect(i6.status).toBe('PAID');
      expect(i6.daysOverdue).toBe(0);
    });
  });

  describe('2. Admin Loan Schedule Dynamic Derivation', () => {
    it('returns dynamically derived status and days_overdue on GET /api/v1/loans/:id', async () => {
      const res = await request(app)
        .get(`/api/v1/loans/${loanId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const installments = res.body.data.installments;
      const i1 = installments.find((i: any) => i.installmentNumber === 1);
      expect(i1.status).toBe('OVERDUE');
      expect(i1.daysOverdue).toBe(15);

      const i2 = installments.find((i: any) => i.installmentNumber === 2);
      expect(i2.status).toBe('OVERDUE');
      expect(i2.daysOverdue).toBe(10);

      const i4 = installments.find((i: any) => i.installmentNumber === 4);
      expect(i4.status).toBe('DUE_TODAY');
      expect(i4.daysOverdue).toBe(0);

      const i5 = installments.find((i: any) => i.installmentNumber === 5);
      expect(i5.status).toBe('UPCOMING');
      expect(i5.daysOverdue).toBe(0);
    });
  });

  describe('3. Collection Agent Recovery Queue', () => {
    it('filters overdue EMIs dynamically via GET /api/v1/agent/queue?status=OVERDUE', async () => {
      const res = await request(app)
        .get(`/api/v1/agent/queue?status=OVERDUE&search=${loanAccountNo}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data;

      // Must include the 3 dynamically overdue installments for this loan
      const ourItems = items.filter((i: any) => i.loanId === loanId);
      expect(ourItems.length).toBe(3);

      for (const item of ourItems) {
        expect(item.status).toBe('OVERDUE');
        expect(item.daysOverdue).toBeGreaterThan(0);
      }
    });

    it('filters due today EMIs dynamically via GET /api/v1/agent/queue?status=DUE_TODAY', async () => {
      const res = await request(app)
        .get(`/api/v1/agent/queue?status=DUE_TODAY&search=${loanAccountNo}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const items = res.body.data;
      const ourDueToday = items.find((i: any) => i.installmentId === dueTodayEmiId);
      expect(ourDueToday).toBeDefined();
      expect(ourDueToday.status).toBe('DUE_TODAY');
      expect(ourDueToday.daysOverdue).toBe(0);
    });

    it('returns accurate overdueCount in agent stats', async () => {
      const res = await request(app)
        .get('/api/v1/agent/stats')
        .set('Authorization', `Bearer ${agentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.overdueCount).toBeGreaterThanOrEqual(3);
      expect(res.body.data.dueTodayCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Finance Dashboard & PAR Reports', () => {
    it('aggregates overdue loans and total overdue dynamically in Finance Dashboard', async () => {
      const res = await request(app)
        .get('/api/v1/reports/finance-dashboard')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.portfolioSummary.overdueLoans).toBeGreaterThanOrEqual(1);
      expect(data.portfolioSummary.totalOverdue).toBeGreaterThanOrEqual(27500.00); // 10000 + 10500 + 7000
    });

    it('places dynamically overdue installments into correct DPD aging buckets in PAR report', async () => {
      const res = await request(app)
        .get(`/api/v1/reports/overdue-par?search=${loanAccountNo}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const summary = res.body.data.summary;
      // All 3 overdue installments (15 DPD, 10 DPD, 5 DPD) are between 1 and 30 days overdue
      expect(Number(summary.parBuckets.par1To30.count)).toBe(3);

      const records = res.body.data.records;
      const ourRecords = records.filter((r: any) => r.loanId === loanId);
      expect(ourRecords.length).toBe(3);

      const r1 = ourRecords.find((r: any) => r.installmentNumber === 1);
      expect(r1.daysOverdue).toBe(15);
      expect(r1.status).toBe('OVERDUE');
    });
  });
});
