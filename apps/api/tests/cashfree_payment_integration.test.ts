import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { CashfreeService } from '../src/core/cashfree/cashfree.service';
import { env, envSchema } from '../src/config/env';
import { PaymentService } from '../src/modules/payments/payments.service';
import { PaymentMode, CollectionSource, UserRole } from '@crm/shared';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
  await closePostgresPool();
});

describe('Cashfree Payments & Redirect Checkout Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const testClientSecret = 'test_secret_key_crm_2026_cashfree';
  const testClientId = 'test_client_id_crm_2026';

  let superAdminId: string;
  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan2Id: string;
  let emi1Id: string;
  let emi2Id: string;
  let portalToken1: string;
  let portalToken2: string;

  beforeAll(async () => {
    // Configure test environment variables for Cashfree
    process.env.CASHFREE_CLIENT_ID = testClientId;
    process.env.CASHFREE_CLIENT_SECRET = testClientSecret;
    process.env.CASHFREE_ENV = 'sandbox';
    process.env.CASHFREE_API_VERSION = '2023-08-01';

    superAdminId = uuidv4();
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Seed super admin user
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin Collector', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [superAdminId, `admin_${runId}@cashfreetest.com`, `+9198${Date.now().toString().slice(-8)}`, hash]
    );

    // 2. Seed Customer 1 and Customer 2
    customer1Id = uuidv4();
    customer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, is_active, created_by, created_at, updated_at)
       VALUES 
         ($1, $2, 'Aarav Patel', '+919876543210', '10 Malviya Nagar', 'Jaipur', 'Rajasthan', '302017', 'ROUTE-1', TRUE, $3, NOW(), NOW()),
         ($4, $5, 'Vikram Singh', '+919123456789', '20 Vaishali Nagar', 'Jaipur', 'Rajasthan', '302021', 'ROUTE-2', TRUE, $3, NOW(), NOW())`,
      [customer1Id, `CUST-CF1-${runId}`, superAdminId, customer2Id, `CUST-CF2-${runId}`]
    );

    // 3. Seed Loan 1 for Customer 1
    loan1Id = uuidv4();
    const loan1AccNo = `LN-CF1-${runId}`;

    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 30000.00, 3000.00, 27000.00,
        12.00, 'FLAT_RATE', 3, 'MONTHLY',
        3, 10000.00, 3000.00, 33000.00, 0.00,
        33000.00, '2026-01-01', '2026-02-01', '2026-04-01',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loan1Id, loan1AccNo, customer1Id, superAdminId]
    );

    // 4. Seed EMIs for Loan 1: Installment 1 (due 10000 + 200 penalty), Installment 2 (due 10000)
    emi1Id = uuidv4();
    emi2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO emi_installments (
        id, loan_id, customer_id, installment_number, due_date, principal_component, interest_component,
        expected_amount, paid_amount, remaining_amount, penalty_amount, status, created_at, updated_at
      ) VALUES 
        ($1, $2, $3, 1, '2026-02-01', 9000.00, 1000.00, 10000.00, 0.00, 10000.00, 250.00, 'OVERDUE', NOW(), NOW()),
        ($4, $2, $3, 2, '2026-03-01', 9000.00, 1000.00, 10000.00, 0.00, 10000.00, 0.00, 'UPCOMING', NOW(), NOW())`,
      [emi1Id, loan1Id, customer1Id, emi2Id]
    );

    // 5. Seed Loan 2 for Customer 2
    loan2Id = uuidv4();
    const loan2AccNo = `LN-CF2-${runId}`;

    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date,
        status, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 20000.00, 2000.00, 18000.00,
        12.00, 'FLAT_RATE', 2, 'MONTHLY',
        2, 10000.00, 2000.00, 22000.00, 0.00,
        22000.00, '2026-01-01', '2026-02-01', '2026-03-01',
        'ACTIVE', $4, NOW(), NOW()
      )`,
      [loan2Id, loan2AccNo, customer2Id, superAdminId]
    );

    // 6. Generate Portal Tokens
    portalToken1 = `cpt_test_tok1_${runId}_${crypto.randomBytes(16).toString('hex')}`;
    const tokenHash1 = crypto.createHash('sha256').update(portalToken1).digest('hex');

    await queryPostgres(
      `INSERT INTO customer_portal_tokens (id, loan_id, customer_id, token_hash, is_active, created_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())`,
      [uuidv4(), loan1Id, customer1Id, tokenHash1]
    );

    portalToken2 = `cpt_test_tok2_${runId}_${crypto.randomBytes(16).toString('hex')}`;
    const tokenHash2 = crypto.createHash('sha256').update(portalToken2).digest('hex');

    await queryPostgres(
      `INSERT INTO customer_portal_tokens (id, loan_id, customer_id, token_hash, is_active, created_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())`,
      [uuidv4(), loan2Id, customer2Id, tokenHash2]
    );
  });

  describe('1. Secure Order Creation', () => {
    it('rejects unauthenticated requests without portal token (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/api/v1/portal/payment/orders')
        .send({ installmentNumber: 1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PORTAL_TOKEN_REQUIRED');
    });

    it('rejects forged or invalid portal tokens (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/v1/portal/payment/orders')
        .set('x-portal-token', 'cpt_fake_invalid_token_9999')
        .send({ installmentNumber: 1 });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('creates an order with authoritative server-calculated amount (10000 + 250 penalty = 10250), ignoring tampered client amounts', async () => {
      // Mock Cashfree gateway response
      const mockSessionId = 'session_mock_h3sW8eURRsT_' + runId;
      jest.spyOn(CashfreeService, 'createOrder').mockImplementationOnce(async (input) => {
        return {
          cfOrderId: 'cf_order_mock_123',
          orderId: input.orderId,
          paymentSessionId: mockSessionId,
          orderStatus: 'ACTIVE',
          orderAmount: input.orderAmount,
          orderCurrency: 'INR',
        };
      });

      const res = await request(app)
        .post('/api/v1/portal/payment/orders')
        .set('x-portal-token', portalToken1)
        .send({
          installmentNumber: 1,
          tamperedAmount: 1.0, // Browser tampering attempt
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderAmount).toBe(10250.0); // Exact expected: 10000 remaining + 250 penalty
      expect(res.body.data.paymentSessionId).toBe(mockSessionId);
      expect(res.body.data.installmentNumber).toBe(1);
      expect(res.body.data.orderId).toMatch(/^CF_CRM_/);

      // Verify record in PostgreSQL database
      const dbOrder = await queryPostgres(
        'SELECT * FROM cashfree_orders WHERE order_id = $1',
        [res.body.data.orderId]
      );
      expect(dbOrder.rows.length).toBe(1);
      expect(Number(dbOrder.rows[0].order_amount)).toBe(10250.0);
      expect(dbOrder.rows[0].status).toBe('ACTIVE');
    });

    it('reuses existing active order if requested within 15 minutes to prevent race conditions', async () => {
      const spy = jest.spyOn(CashfreeService, 'createOrder');
      spy.mockClear();

      const res = await request(app)
        .post('/api/v1/portal/payment/orders')
        .set('x-portal-token', portalToken1)
        .send({ installmentNumber: 1 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderAmount).toBe(10250.0);
      // Ensure Cashfree API was not called again because active order was reused
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects order creation for an installment that is already paid', async () => {
      // Mark installment 2 as paid
      await queryPostgres(
        `UPDATE emi_installments SET paid_amount = 10000.00, remaining_amount = 0.00, status = 'PAID' WHERE id = $1`,
        [emi2Id]
      );

      const res = await request(app)
        .post('/api/v1/portal/payment/orders')
        .set('x-portal-token', portalToken1)
        .send({ installmentNumber: 2 });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('already fully paid');
    });
  });

  describe('2. Cashfree Webhook Signature & Event Processing', () => {
    it('rejects webhook requests with missing or invalid HMAC signature (400 Bad Request)', async () => {
      const payload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {},
      };

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', String(Math.floor(Date.now() / 1000)))
        .set('x-webhook-signature', 'invalid_signature_base64==')
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    });

    it('rejects webhook requests with stale timestamp (older than 300 seconds)', async () => {
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const rawBody = JSON.stringify({ type: 'TEST' });
      const signature = crypto
        .createHmac('sha256', testClientSecret)
        .update(staleTimestamp + rawBody)
        .digest('base64');

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', staleTimestamp)
        .set('x-webhook-signature', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('expired');
    });

    it('processes a valid PAYMENT_SUCCESS_WEBHOOK: allocates payment, updates loan balance and marks order PAID', async () => {
      // Find the active order created earlier
      const orderRes = await queryPostgres(
        `SELECT order_id, order_amount FROM cashfree_orders WHERE loan_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [loan1Id]
      );
      const activeOrderId = orderRes.rows[0].order_id;
      const orderAmount = Number(orderRes.rows[0].order_amount);

      const cfPaymentId = 'cf_pay_' + Date.now();
      const webhookPayload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {
          order: {
            order_id: activeOrderId,
            order_amount: orderAmount,
            order_currency: 'INR',
          },
          payment: {
            cf_payment_id: cfPaymentId,
            payment_status: 'SUCCESS',
            payment_amount: orderAmount,
            payment_currency: 'INR',
            payment_group: 'upi',
            bank_reference: 'UPI987654321',
            payment_time: new Date().toISOString(),
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = crypto
        .createHmac('sha256', testClientSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify that payment record was created in the payments ledger
      const pmtRes = await queryPostgres(
        `SELECT id, amount, penalty_amount, status, payment_mode, reference_number, receipt_number
         FROM payments WHERE reference_number = $1`,
        [`CF-${cfPaymentId}`]
      );
      expect(pmtRes.rows.length).toBe(1);
      expect(Number(pmtRes.rows[0].amount)).toBe(orderAmount);
      expect(pmtRes.rows[0].status).toBe('SUCCESS');
      expect(pmtRes.rows[0].receipt_number).toMatch(/^RCP-\d{8}-\d+/);

      // Verify cashfree_orders updated to PAID
      const updatedOrder = await queryPostgres(
        'SELECT status, cf_payment_id, payment_id FROM cashfree_orders WHERE order_id = $1',
        [activeOrderId]
      );
      expect(updatedOrder.rows[0].status).toBe('PAID');
      expect(updatedOrder.rows[0].cf_payment_id).toBe(cfPaymentId);
      expect(updatedOrder.rows[0].payment_id).toBe(pmtRes.rows[0].id);

      // Verify loan outstanding balance decreased by principal & interest (10,000)
      const updatedLoan = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(updatedLoan.rows[0].outstanding_balance)).toBe(23000.0); // 33000 - 10000 P&I
      expect(Number(updatedLoan.rows[0].total_paid)).toBe(orderAmount); // 10250 total paid
    });

    it('handles duplicate webhook delivery idempotently without creating duplicate ledger records', async () => {
      // Find the paid order and payment
      const orderRes = await queryPostgres(
        `SELECT order_id, order_amount, cf_payment_id FROM cashfree_orders WHERE loan_id = $1 AND status = 'PAID' LIMIT 1`,
        [loan1Id]
      );
      const activeOrderId = orderRes.rows[0].order_id;
      const orderAmount = Number(orderRes.rows[0].order_amount);
      const cfPaymentId = orderRes.rows[0].cf_payment_id;

      const webhookPayload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {
          order: {
            order_id: activeOrderId,
            order_amount: orderAmount,
            order_currency: 'INR',
          },
          payment: {
            cf_payment_id: cfPaymentId,
            payment_status: 'SUCCESS',
            payment_amount: orderAmount,
            payment_currency: 'INR',
            payment_group: 'upi',
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = crypto
        .createHmac('sha256', testClientSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const countBefore = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan1Id]);

      // Re-send the same webhook
      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const countAfter = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan1Id]);
      expect(Number(countAfter.rows[0].count)).toBe(Number(countBefore.rows[0].count));
    });

    it('rejects webhook if payment amount does not match authoritative order amount', async () => {
      // Create a test order for loan 2
      const testOrderId = `CF_CRM_TEST_MISMATCH_${runId}`;
      await queryPostgres(
        `INSERT INTO cashfree_orders (id, order_id, loan_id, customer_id, order_amount, order_currency, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 10000.00, 'INR', 'ACTIVE', NOW(), NOW())`,
        [uuidv4(), testOrderId, loan2Id, customer2Id]
      );

      const webhookPayload = {
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {
          order: {
            order_id: testOrderId,
            order_amount: 10000.00,
          },
          payment: {
            cf_payment_id: 'cf_pay_tampered_' + runId,
            payment_status: 'SUCCESS',
            payment_amount: 5000.00, // Mismatched gateway amount!
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = crypto
        .createHmac('sha256', testClientSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Amount mismatch');
    });

    it('processes a valid PAYMENT_FAILED_WEBHOOK: updates order status to FAILED and does not create a ledger payment', async () => {
      const failedOrderId = `CF_CRM_FAIL_${runId}`;
      await queryPostgres(
        `INSERT INTO cashfree_orders (id, order_id, loan_id, customer_id, order_amount, order_currency, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 5000.00, 'INR', 'ACTIVE', NOW(), NOW())`,
        [uuidv4(), failedOrderId, loan2Id, customer2Id]
      );

      const paymentsCountBefore = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan2Id]);

      const webhookPayload = {
        type: 'PAYMENT_FAILED_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {
          order: {
            order_id: failedOrderId,
            order_amount: 5000.00,
          },
          payment: {
            cf_payment_id: 'cf_pay_failed_' + runId,
            payment_status: 'FAILED',
            payment_amount: 5000.00,
            payment_message: 'Insufficient balance in bank account',
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = crypto
        .createHmac('sha256', testClientSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbOrder = await queryPostgres('SELECT status, error_message FROM cashfree_orders WHERE order_id = $1', [failedOrderId]);
      expect(dbOrder.rows[0].status).toBe('FAILED');
      expect(dbOrder.rows[0].error_message).toContain('Insufficient balance');

      const paymentsCountAfter = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan2Id]);
      expect(Number(paymentsCountAfter.rows[0].count)).toBe(Number(paymentsCountBefore.rows[0].count));
    });

    it('processes a valid PAYMENT_USER_DROPPED_WEBHOOK: updates order status to USER_DROPPED and does not create a ledger payment', async () => {
      const droppedOrderId = `CF_CRM_DROPPED_${runId}`;
      await queryPostgres(
        `INSERT INTO cashfree_orders (id, order_id, loan_id, customer_id, order_amount, order_currency, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 5000.00, 'INR', 'ACTIVE', NOW(), NOW())`,
        [uuidv4(), droppedOrderId, loan2Id, customer2Id]
      );

      const paymentsCountBefore = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan2Id]);

      const webhookPayload = {
        type: 'PAYMENT_USER_DROPPED_WEBHOOK',
        event_time: new Date().toISOString(),
        data: {
          order: {
            order_id: droppedOrderId,
            order_amount: 5000.00,
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const validSignature = crypto
        .createHmac('sha256', testClientSecret)
        .update(timestamp + rawBody)
        .digest('base64');

      const res = await request(app)
        .post('/api/v1/payments/cashfree/webhook')
        .set('x-webhook-timestamp', timestamp)
        .set('x-webhook-signature', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const dbOrder = await queryPostgres('SELECT status, error_message FROM cashfree_orders WHERE order_id = $1', [droppedOrderId]);
      expect(dbOrder.rows[0].status).toBe('USER_DROPPED');

      const paymentsCountAfter = await queryPostgres('SELECT COUNT(*) as count FROM payments WHERE loan_id = $1', [loan2Id]);
      expect(Number(paymentsCountAfter.rows[0].count)).toBe(Number(paymentsCountBefore.rows[0].count));
    });
  });

  describe('3. Server-to-Server Payment Status Verification', () => {
    it('verifies paid order and returns receipt details to customer portal session', async () => {
      const orderRes = await queryPostgres(
        `SELECT order_id, order_amount FROM cashfree_orders WHERE loan_id = $1 AND status = 'PAID' LIMIT 1`,
        [loan1Id]
      );
      const paidOrderId = orderRes.rows[0].order_id;

      const res = await request(app)
        .get(`/api/v1/portal/payment/orders/${paidOrderId}/verify`)
        .set('x-portal-token', portalToken1);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.orderId).toBe(paidOrderId);
      expect(res.body.data.receiptNumber).toMatch(/^RCP-\d{8}-\d+/);
    });

    it('blocks cross-customer verification (Customer 2 attempting to verify Customer 1 order returns 404)', async () => {
      const orderRes = await queryPostgres(
        `SELECT order_id FROM cashfree_orders WHERE loan_id = $1 LIMIT 1`,
        [loan1Id]
      );
      const order1Id = orderRes.rows[0].order_id;

      // Customer 2 attempts to query Customer 1's order
      const res = await request(app)
        .get(`/api/v1/portal/payment/orders/${order1Id}/verify`)
        .set('x-portal-token', portalToken2);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('verifies active order with Cashfree gateway directly when webhook is delayed', async () => {
      const testOrderId = `CF_CRM_VERIFY_DELAYED_${runId}`;
      await queryPostgres(
        `INSERT INTO cashfree_orders (id, order_id, loan_id, customer_id, order_amount, order_currency, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 10000.00, 'INR', 'ACTIVE', NOW(), NOW())`,
        [uuidv4(), testOrderId, loan2Id, customer2Id]
      );

      // Mock gateway returning SUCCESS payment attempt
      jest.spyOn(CashfreeService, 'getOrderPayments').mockResolvedValueOnce([
        {
          cfPaymentId: 'cf_pay_delayed_' + runId,
          paymentStatus: 'SUCCESS',
          paymentAmount: 10000.00,
          paymentCurrency: 'INR',
          paymentGroup: 'upi',
          bankReference: 'UPI_DELAYED_123',
          paymentTime: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/portal/payment/orders/${testOrderId}/verify`)
        .set('x-portal-token', portalToken2);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUCCESS');
      expect(res.body.data.receiptNumber).toMatch(/^RCP-\d{8}-\d+/);

      // Verify order is now PAID in PostgreSQL
      const dbOrder = await queryPostgres('SELECT status FROM cashfree_orders WHERE order_id = $1', [testOrderId]);
      expect(dbOrder.rows[0].status).toBe('PAID');
    });
  });

  describe('4. Concurrent Payment Idempotency & Race Handling', () => {
    it('handles concurrent processing of the same payment idempotency key safely without double-posting', async () => {
      const concurrentIdempotencyKey = `concurrent_cf_${runId}_${Date.now()}`;
      const recordingUser = {
        id: superAdminId,
        email: `admin_${runId}@cashfreetest.com`,
        role: UserRole.SUPER_ADMIN,
        fullName: 'Super Admin Collector',
      };

      // Launch 2 parallel payment records with the EXACT same payload and idempotency key
      const [res1, res2] = await Promise.all([
        PaymentService.recordPayment(
          {
            loanId: loan2Id,
            customerId: customer2Id,
            amount: 1000.00,
            paymentMode: PaymentMode.UPI,
            collectionSource: CollectionSource.DIRECT_CUSTOMER,
            referenceNumber: `CF-CONC-${runId}-1`,
            notes: 'Concurrent race test 1',
            idempotencyKey: concurrentIdempotencyKey,
          },
          recordingUser
        ),
        PaymentService.recordPayment(
          {
            loanId: loan2Id,
            customerId: customer2Id,
            amount: 1000.00,
            paymentMode: PaymentMode.UPI,
            collectionSource: CollectionSource.DIRECT_CUSTOMER,
            referenceNumber: `CF-CONC-${runId}-2`,
            notes: 'Concurrent race test 2',
            idempotencyKey: concurrentIdempotencyKey,
          },
          recordingUser
        ),
      ]);

      // Both must succeed and resolve to the exact same payment ID and receipt number
      expect(res1.id).toBeDefined();
      expect(res2.id).toBeDefined();
      expect(res1.id).toBe(res2.id);
      expect(res1.receiptNumber).toBe(res2.receiptNumber);

      // Confirm only ONE record exists in the database for this idempotency key
      const pmtRes = await queryPostgres(
        'SELECT id, amount, receipt_number FROM payments WHERE idempotency_key = $1',
        [concurrentIdempotencyKey]
      );
      expect(pmtRes.rows.length).toBe(1);
      expect(Number(pmtRes.rows[0].amount)).toBe(1000.00);
    });
  });

  describe('5. Environment Configuration Validation', () => {
    it('rejects startup/validation when CASHFREE_ENV=production but credentials are missing', () => {
      const sampleEnv = {
        NODE_ENV: 'production',
        PORT: '4000',
        DATABASE_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        JWT_SECRET: 'test_super_secret_jwt_32_characters_long_min',
        JWT_REFRESH_SECRET: 'test_super_secret_jwt_refresh_32_chars',
        REDIS_URL: 'redis://localhost:6379',
        STORAGE_PROVIDER: 's3',
        AWS_ACCESS_KEY_ID: 'fake_key',
        AWS_SECRET_ACCESS_KEY: 'fake_secret',
        PORTAL_BASE_URL: 'https://crm.example.com/portal',
        CASHFREE_ENV: 'production',
        CASHFREE_CLIENT_ID: '',
        CASHFREE_CLIENT_SECRET: '',
      };

      const result = envSchema.safeParse(sampleEnv);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('CASHFREE_CLIENT_ID');
        expect(paths).toContain('CASHFREE_CLIENT_SECRET');
      }
    });

    it('allows startup in sandbox when credentials are not configured', () => {
      const sampleEnv = {
        NODE_ENV: 'development',
        CASHFREE_ENV: 'sandbox',
        CASHFREE_CLIENT_ID: undefined,
        CASHFREE_CLIENT_SECRET: undefined,
      };

      const result = envSchema.safeParse(sampleEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.CASHFREE_ENV).toBe('sandbox');
        expect(result.data.CASHFREE_CLIENT_ID).toBeUndefined();
      }
    });

    it('fails order creation clearly with HTTP 503 if credentials are not configured in sandbox', async () => {
      const savedId = process.env.CASHFREE_CLIENT_ID;
      const savedSecret = process.env.CASHFREE_CLIENT_SECRET;
      try {
        delete process.env.CASHFREE_CLIENT_ID;
        delete process.env.CASHFREE_CLIENT_SECRET;

        const res = await request(app)
          .post('/api/v1/portal/payment/orders')
          .set('x-portal-token', portalToken1)
          .send({ installmentNumber: 1 });

        expect(res.status).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error.message).toContain('Cashfree payment gateway is not configured');
      } finally {
        process.env.CASHFREE_CLIENT_ID = savedId;
        process.env.CASHFREE_CLIENT_SECRET = savedSecret;
      }
    });
  });
});
