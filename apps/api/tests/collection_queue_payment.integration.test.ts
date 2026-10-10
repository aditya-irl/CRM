import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import {
  UserRole,
  PaymentMode,
  CollectionSource,
  getBusinessDate,
  addDays,
} from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Collection Queue Payment & RLAC Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@cqtest.com`;
  const agent1Email = `agent1_${runId}@cqtest.com`;
  const agent2Email = `agent2_${runId}@cqtest.com`;
  const dealerEmail = `dealer_${runId}@cqtest.com`;

  let adminToken: string;
  let agent1Token: string;
  let agent2Token: string;
  let dealerToken: string;

  let adminId: string;
  let agent1Id: string;
  let agent2Id: string;
  let dealerUserId: string;
  let dealerId: string;

  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan2Id: string;
  let loan3Id: string;
  let emi1Id: string;
  let emi2Id: string;
  let emi3Id: string;

  const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
  const pastDueDate = addDays(businessToday, -10);
  const futureDueDate = addDays(businessToday, 20);

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();
    dealerUserId = uuidv4();
    dealerId = uuidv4();

    customer1Id = uuidv4();
    customer2Id = uuidv4();
    loan1Id = uuidv4();
    loan2Id = uuidv4();
    loan3Id = uuidv4();
    emi1Id = uuidv4();
    emi2Id = uuidv4();
    emi3Id = uuidv4();

    // 1. Seed Dealer
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES ($1, $2, 'Metro Electronics', 'Sunil Kumar', $3, 'Delhi', 'Connaught Place', 'ACTIVE', NOW(), NOW())`,
      [dealerId, `DLR-${runId}`, `+9198${numId}0`]
    );

    // 2. Seed Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES 
         ($1, $2, $3, $4, 'CRM Super Admin', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $4, 'Agent Ramesh (Queue Collector)', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($8, $9, $10, $4, 'Agent Suresh (Other Agent)', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW()),
         ($11, $12, $13, $4, 'Store Dealer Manager', 'DEALER', $14, 'ACTIVE', NOW(), NOW())`,
      [
        adminId, adminEmail, `+9191${numId}1`, hash,
        agent1Id, agent1Email, `+9191${numId}2`,
        agent2Id, agent2Email, `+9191${numId}3`,
        dealerUserId, dealerEmail, `+9191${numId}4`, dealerId,
      ]
    );

    // 3. Login All Users
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const a1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = a1Login.body.data.tokens.accessToken;

    const a2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = a2Login.body.data.tokens.accessToken;

    const dlrLogin = await request(app).post('/api/v1/auth/login').send({ email: dealerEmail, password: 'Password@123' });
    dealerToken = dlrLogin.body.data.tokens.accessToken;

    // 4. Seed Customers
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES 
         ($1, $2, 'Customer Vikas', $3, 'Flat 101, Delhi', 'Delhi', 'Delhi', '110001', 'Route-East', NOW(), NOW()),
         ($4, $5, 'Customer Manoj', $6, 'Flat 202, Delhi', 'Delhi', 'Delhi', '110001', 'Route-West', NOW(), NOW())`,
      [
        customer1Id, `CUST-V-${runId}`, `+9192${numId}1`,
        customer2Id, `CUST-M-${runId}`, `+9192${numId}2`,
      ]
    );

    // 5. Seed Loans (Note: loans.assigned_agent_id is deliberately NULL on Loan 1 to verify collection_assignments RLAC!)
    await queryPostgres(
      `INSERT INTO loans (
        id, customer_id, dealer_id, loan_account_no, assigned_agent_id,
        principal_amount, down_payment, net_disbursed_amount, total_interest, total_payable,
        total_paid, outstanding_balance, emi_amount, total_installments,
        tenure_months, annual_interest_rate, status, disbursement_date, first_emi_date, maturity_date,
        created_at, updated_at
      ) VALUES 
        ($1, $2, $3, $4, NULL, 13125.00, 0.00, 13125.00, 0.00, 13125.00, 0.00, 13125.00, 4375.00, 3, 3, 0.00, 'ACTIVE', $5, $5, $6, NOW(), NOW()),
        ($7, $8, $3, $9, $10, 13125.00, 0.00, 13125.00, 0.00, 13125.00, 0.00, 13125.00, 4375.00, 3, 3, 0.00, 'ACTIVE', $5, $5, $6, NOW(), NOW()),
        ($11, $2, $3, $12, NULL, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 0.00, 8750.00, 4375.00, 2, 2, 0.00, 'ACTIVE', $5, $5, $6, NOW(), NOW())`,
      [
        loan1Id, customer1Id, dealerId, `LN-V1-${runId}`, pastDueDate, futureDueDate,
        loan2Id, customer2Id, `LN-M1-${runId}`, agent2Id,
        loan3Id, `LN-V2-${runId}`,
      ]
    );

    // 6. Seed Installments
    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date,
        principal_component, interest_component, expected_amount,
        paid_amount, remaining_amount, penalty_amount, status, days_overdue,
        created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, $4, 4375, 0, 4375, 0, 4375, 0, 'OVERDUE', 10, NOW(), NOW()),
        ($5, $6, $7, 1, $4, 4375, 0, 4375, 0, 4375, 0, 'OVERDUE', 10, NOW(), NOW()),
        ($8, $9, $3, 1, $4, 4375, 0, 4375, 0, 4375, 0, 'OVERDUE', 10, NOW(), NOW())`,
      [
        emi1Id, loan1Id, customer1Id, pastDueDate,
        emi2Id, loan2Id, customer2Id,
        emi3Id, loan3Id,
      ]
    );

    // 7. Seed Collection Assignment for Agent 1 on Customer 1 (Queue Assignment)
    await queryPostgres(
      `INSERT INTO collection_assignments (
        id, agent_id, customer_id, loan_id, assigned_by, is_active, effective_from, created_at
      ) VALUES ($1, $2, $3, $4, $5, TRUE, CURRENT_DATE, NOW())`,
      [uuidv4(), agent1Id, customer1Id, loan1Id, adminId]
    );
  });

  describe('1. Collection Queue Payment without Penalty', () => {
    let recordedPaymentId: string;

    test('Collection Agent records payment on assigned queue loan without penalty successfully', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan1Id,
          emiId: emi1Id,
          customerId: customer1Id,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId: agent1Id,
          idempotencyKey: `AGT_PAY_1_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      recordedPaymentId = data.paymentId || data.id;

      expect(data.amountCollected).toBe(4375);
      expect(data.paymentAmount).toBe(4375);
      expect(data.penaltyAmount).toBe(0);

      // Verify DB record
      const payDb = await queryPostgres(
        `SELECT amount, penalty_amount, collection_source, collected_by_agent_id, agent_id
         FROM payments WHERE id = $1`,
        [recordedPaymentId]
      );
      expect(payDb.rows.length).toBe(1);
      expect(Number(payDb.rows[0].amount)).toBe(4375);
      expect(Number(payDb.rows[0].penalty_amount)).toBe(0);
      expect(payDb.rows[0].collection_source).toBe('RECOVERY_AGENT');
      expect(payDb.rows[0].collected_by_agent_id).toBe(agent1Id);
      expect(payDb.rows[0].agent_id).toBe(agent1Id);
    });

    test('Collection Agent receipt retrieval shows recovery agent source and no fake penalty line', async () => {
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${recordedPaymentId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(receiptRes.status).toBe(200);
      expect(receiptRes.body.success).toBe(true);
      const receipt = receiptRes.body.data;

      expect(receipt.amount).toBe(4375);
      expect(receipt.penaltyAmount).toBe(0);
      expect(receipt.paymentAmount).toBe(4375);
      expect(receipt.collectionSource).toBe('RECOVERY_AGENT');
      expect(receipt.allocations[0].principalComponent).toBe(4375);
      expect(receipt.allocations[0].penaltyComponent).toBe(0);
    });

    test('Payment updates loan outstanding balance correctly', async () => {
      const loanDb = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanDb.rows[0].outstanding_balance)).toBe(8750);
      expect(Number(loanDb.rows[0].total_paid)).toBe(4375);
    });
  });

  describe('2. Collection Queue Payment with Manual Penalty', () => {
    let penaltyPaymentId: string;

    test('Collection Agent records payment with explicit manual penalty (₹4,375 P&I + ₹150 penalty)', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan3Id,
          emiId: emi3Id,
          customerId: customer1Id,
          amount: 4375,
          penaltyAmount: 150,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId: agent1Id,
          idempotencyKey: `AGT_PAY_PEN_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      penaltyPaymentId = data.paymentId || data.id;

      expect(data.amountCollected).toBe(4525);
      expect(data.paymentAmount).toBe(4375);
      expect(data.penaltyAmount).toBe(150);

      // Verify DB row
      const payDb = await queryPostgres(
        'SELECT amount, penalty_amount, collection_source FROM payments WHERE id = $1',
        [penaltyPaymentId]
      );
      expect(payDb.rows.length).toBe(1);
      expect(Number(payDb.rows[0].amount)).toBe(4525);
      expect(Number(payDb.rows[0].penalty_amount)).toBe(150);
      expect(payDb.rows[0].collection_source).toBe('RECOVERY_AGENT');
    });

    test('Receipt displays manually entered Late Payment Penalty', async () => {
      const receiptRes = await request(app)
        .get(`/api/v1/payments/receipt/${penaltyPaymentId}`)
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(receiptRes.status).toBe(200);
      expect(receiptRes.body.success).toBe(true);
      const receipt = receiptRes.body.data;

      expect(receipt.amount).toBe(4525);
      expect(receipt.penaltyAmount).toBe(150);
      expect(receipt.paymentAmount).toBe(4375);
      expect(receipt.allocations[0].penaltyComponent).toBe(150);
    });
  });

  describe('3. Backwards Compatibility for Missing penaltyAmount', () => {
    test('Payment request without penaltyAmount field succeeds gracefully (defaults to 0)', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan3Id,
          customerId: customer1Id,
          amount: 2000,
          paymentMode: 'UPI',
          collectionSource: 'RECOVERY_AGENT',
          agentId: agent1Id,
          idempotencyKey: `AGT_NO_PEN_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amountCollected).toBe(2000);
      expect(res.body.data.penaltyAmount).toBe(0);
    });
  });

  describe('4. Strict RLAC Security Enforcement', () => {
    test('Agent 1 cannot record payment against loan assigned to Agent 2 (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent1Token}`)
        .send({
          loanId: loan2Id,
          emiId: emi2Id,
          customerId: customer2Id,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId: agent1Id,
          idempotencyKey: `AGT_FORBIDDEN_${runId}`,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body.error)).toMatch(/authorized/i);
    });

    test('Agent 2 can record payment against their own assigned loan', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${agent2Token}`)
        .send({
          loanId: loan2Id,
          emiId: emi2Id,
          customerId: customer2Id,
          amount: 4375,
          penaltyAmount: 0,
          paymentMode: 'CASH',
          collectionSource: 'RECOVERY_AGENT',
          agentId: agent2Id,
          idempotencyKey: `AGT2_ALLOWED_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amountCollected).toBe(4375);
    });
  });

  describe('5. Admin & Dealer Collection Flows', () => {
    test('Admin direct customer payment still works from Collection Queue / Admin UI', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: 1000,
          paymentMode: 'BANK_TRANSFER',
          collectionSource: 'DIRECT_CUSTOMER',
          idempotencyKey: `ADMIN_PAY_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.collectionSource).toBe('DIRECT_CUSTOMER');
    });

    test('Dealer partner store collection flow still works with correct partner source', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerToken}`)
        .send({
          loanId: loan2Id,
          customerId: customer2Id,
          amount: 1000,
          paymentMode: 'CASH',
          collectionSource: CollectionSource.DEALER,
          dealerId,
          idempotencyKey: `DEALER_PAY_${runId}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.collectionSource).toBe(CollectionSource.DEALER);
    });
  });
});
