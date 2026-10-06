import request from 'supertest';
import app from '../src/app';
import { initDatabase } from '../src/database/db';
import { seedDatabase, seedPostgres } from '../src/database/seed';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { InterestMethod, RepaymentFrequency } from '@crm/shared';

beforeAll(async () => {
  initDatabase();
  seedDatabase();
  await seedPostgres();
});

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Manual EMI Start Date and Tenure Selection Integration Tests', () => {
  let adminToken: string;
  let testCustomerId: string;

  beforeAll(async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    adminToken = loginRes.body.data.tokens.accessToken;

    const custRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'EMI Schedule Test Borrower',
        primaryPhone: '+919876543299',
        addressLine1: 'Test Market Complex',
        city: 'Jaipur',
        state: 'Rajasthan',
        pincode: '302001',
        areaRoute: 'MI Road',
      });
    testCustomerId = custRes.body.data.id;
  });

  describe('1. Loan Calculation Preview API (/api/v1/loans/calculate-preview)', () => {
    test('Calculates schedule with Loan Date = 2026-10-06, EMI Start Date = 2026-11-05, Tenure = 12', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 60000,
          downPayment: 10000,
          annualInterestRate: 14,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-05',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.disbursementDate).toBe('2026-10-06');
      expect(data.firstEmiDate).toBe('2026-11-05');
      expect(data.tenureMonths).toBe(12);
      expect(data.totalInstallments).toBe(12);
      expect(data.schedule.length).toBe(12);

      // Verify exact installment sequence
      expect(data.schedule[0].dueDate).toBe('2026-11-05');
      expect(data.schedule[1].dueDate).toBe('2026-12-05');
      expect(data.schedule[2].dueDate).toBe('2027-01-05');
      expect(data.schedule[10].dueDate).toBe('2027-09-05');
      expect(data.schedule[11].dueDate).toBe('2027-10-05');
      expect(data.maturityDate).toBe('2027-10-05');
    });

    test('Updating EMI Start Date shifts all due dates without modifying EMI amount', async () => {
      const resNov = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 50000,
          downPayment: 5000,
          annualInterestRate: 15,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-05',
        });

      const resDec = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 50000,
          downPayment: 5000,
          annualInterestRate: 15,
          interestCalcMethod: InterestMethod.REDUCING_BALANCE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-12-15',
        });

      expect(resNov.status).toBe(200);
      expect(resDec.status).toBe(200);

      // Financial invariance: amounts remain strictly equal
      expect(resNov.body.data.emiAmount).toBe(resDec.body.data.emiAmount);
      expect(resNov.body.data.totalInterest).toBe(resDec.body.data.totalInterest);
      expect(resNov.body.data.totalPayable).toBe(resDec.body.data.totalPayable);

      // Schedule dates updated
      expect(resNov.body.data.schedule[0].dueDate).toBe('2026-11-05');
      expect(resDec.body.data.schedule[0].dueDate).toBe('2026-12-15');
      expect(resNov.body.data.maturityDate).toBe('2027-04-05');
      expect(resDec.body.data.maturityDate).toBe('2027-05-15');
    });

    test('Updating Tenure changes installment count and recalculates EMI amount', async () => {
      const res6 = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 30000,
          annualInterestRate: 12,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-05',
        });

      const res12 = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 30000,
          annualInterestRate: 12,
          tenureMonths: 12,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-05',
        });

      expect(res6.body.data.totalInstallments).toBe(6);
      expect(res6.body.data.schedule.length).toBe(6);
      expect(res12.body.data.totalInstallments).toBe(12);
      expect(res12.body.data.schedule.length).toBe(12);

      // 6-month EMI is higher than 12-month EMI
      expect(res6.body.data.emiAmount).toBeGreaterThan(res12.body.data.emiAmount);
    });

    test('Month-end clamping when manual EMI Start Date is on 31st', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 40000,
          annualInterestRate: 12,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-01-15',
          firstEmiDate: '2026-01-31',
        });

      expect(res.status).toBe(200);
      const sched = res.body.data.schedule;
      expect(sched[0].dueDate).toBe('2026-01-31');
      expect(sched[1].dueDate).toBe('2026-02-28'); // Clamped to Feb 28
      expect(sched[2].dueDate).toBe('2026-03-31');
      expect(sched[3].dueDate).toBe('2026-04-30'); // Clamped to Apr 30
      expect(sched[4].dueDate).toBe('2026-05-31');
      expect(sched[5].dueDate).toBe('2026-06-30'); // Clamped to Jun 30
    });

    test('Validates emiStartDate cannot be earlier than disbursementDate', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 40000,
          annualInterestRate: 12,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-09-01', // Before disbursement date
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toContain('EMI Start Date cannot be earlier than loan disbursement date');
    });

    test('Validates emiStartDate must be a real calendar date', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 40000,
          annualInterestRate: 12,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-02-30', // Invalid calendar date
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toContain('EMI Start Date must be a valid calendar date');
    });

    test('Accepts emiStartDate alias identically to firstEmiDate', async () => {
      const res = await request(app)
        .post('/api/v1/loans/calculate-preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          principalAmount: 50000,
          annualInterestRate: 12,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          disbursementDate: '2026-10-06',
          emiStartDate: '2026-11-10',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.firstEmiDate).toBe('2026-11-10');
      expect(res.body.data.schedule[0].dueDate).toBe('2026-11-10');
    });
  });

  describe('2. Loan Origination & Persistence (/api/v1/loans)', () => {
    test('Persists loan with manual firstEmiDate and generates exact installments in PostgreSQL', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: testCustomerId,
          principalAmount: 48000,
          downPayment: 0,
          annualInterestRate: 12,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-11-05',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const loan = res.body.data;
      expect(loan.id).toBeDefined();
      expect(loan.disbursementDate).toBe('2026-10-06');
      expect(loan.firstEmiDate).toBe('2026-11-05');
      expect(loan.maturityDate).toBe('2027-04-05');
      expect(Number(loan.tenureMonths)).toBe(6);
      expect(Number(loan.totalInstallments)).toBe(6);

      // Query database directly using TO_CHAR to verify raw stored ISO date values
      const dbLoan = await queryPostgres(
        `SELECT TO_CHAR(disbursement_date, 'YYYY-MM-DD') as disb_date,
                TO_CHAR(first_emi_date, 'YYYY-MM-DD') as first_due,
                TO_CHAR(maturity_date, 'YYYY-MM-DD') as mat_date,
                tenure_months, total_installments
         FROM loans WHERE id = $1`,
        [loan.id]
      );
      expect(dbLoan.rows.length).toBe(1);
      const row = dbLoan.rows[0];
      expect(row.disb_date).toBe('2026-10-06');
      expect(row.first_due).toBe('2026-11-05');
      expect(row.mat_date).toBe('2027-04-05');
      expect(Number(row.tenure_months)).toBe(6);
      expect(Number(row.total_installments)).toBe(6);

      // Verify emi_installments in database
      const dbEmis = await queryPostgres(
        `SELECT installment_number, TO_CHAR(due_date, 'YYYY-MM-DD') as due_date
         FROM emi_installments WHERE loan_id = $1 ORDER BY installment_number ASC`,
        [loan.id]
      );
      expect(dbEmis.rows.length).toBe(6);
      expect(dbEmis.rows[0].due_date).toBe('2026-11-05');
      expect(dbEmis.rows[1].due_date).toBe('2026-12-05');
      expect(dbEmis.rows[2].due_date).toBe('2027-01-05');
      expect(dbEmis.rows[3].due_date).toBe('2027-02-05');
      expect(dbEmis.rows[4].due_date).toBe('2027-03-05');
      expect(dbEmis.rows[5].due_date).toBe('2027-04-05');
    });

    test('Rejects loan creation if firstEmiDate < disbursementDate', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          customerId: testCustomerId,
          principalAmount: 48000,
          annualInterestRate: 12,
          tenureMonths: 6,
          disbursementDate: '2026-10-06',
          firstEmiDate: '2026-10-01',
        });

      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain('EMI Start Date cannot be earlier than loan disbursement date');
    });
  });
});
