import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import {
  UserRole,
  PaymentMode,
  CollectionSource,
  PaymentStatus,
  InterestMethod,
  RepaymentFrequency,
  DealerPayableStatus,
  SettlementStatus,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Comprehensive Dealer Complete Workflow Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  let superAdminToken: string;
  let adminToken: string;
  let dealer1Token: string;
  let dealer2Token: string;
  let agentToken: string;

  let dealer1Id: string;
  let dealer2Id: string;

  let customer1Id: string;
  let customer2Id: string;

  let loan1Id: string;
  let rejectedLoanId: string;

  let paymentId: string;
  let secondPaymentId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Seed Dealers
    dealer1Id = uuidv4();
    dealer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, area_city, address, status, created_at, updated_at)
       VALUES
         ($1, $2, 'Alpha Mobile Hub', 'Rohan Sharma', $3, 'Mumbai', 'Shop 12, Linking Rd', 'ACTIVE', NOW(), NOW()),
         ($4, $5, 'Beta Phone Gallery', 'Vikram Patel', $6, 'Pune', 'Shop 45, FC Rd', 'ACTIVE', NOW(), NOW())`,
      [
        dealer1Id, `DLR_WF_${runId}_1`, `9820${numId}1`,
        dealer2Id, `DLR_WF_${runId}_2`, `9820${numId}2`,
      ]
    );

    // 2. Seed Users
    const superAdminId = uuidv4();
    const adminId = uuidv4();
    const dealer1UserId = uuidv4();
    const dealer2UserId = uuidv4();
    const agentUserId = uuidv4();

    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES
         ($1, $2, $3, $4, 'Super Admin WF', 'SUPER_ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($5, $6, $7, $8, 'Admin User WF', 'ADMIN', NULL, 'ACTIVE', NOW(), NOW()),
         ($9, $10, $11, $12, 'Dealer One User', 'DEALER', $13, 'ACTIVE', NOW(), NOW()),
         ($14, $15, $16, $17, 'Dealer Two User', 'DEALER', $18, 'ACTIVE', NOW(), NOW()),
         ($19, $20, $21, $22, 'Recovery Agent WF', 'COLLECTION_AGENT', NULL, 'ACTIVE', NOW(), NOW())`,
      [
        superAdminId, `sadmin_${runId}@crm.com`, `9800${numId}1`, hash,
        adminId, `admin_${runId}@crm.com`, `9800${numId}2`, hash,
        dealer1UserId, `dealer1_${runId}@crm.com`, `9800${numId}3`, hash, dealer1Id,
        dealer2UserId, `dealer2_${runId}@crm.com`, `9800${numId}4`, hash, dealer2Id,
        agentUserId, `agent_${runId}@crm.com`, `9800${numId}5`, hash,
      ]
    );

    // 3. Login Users
    const saLogin = await request(app).post('/api/v1/auth/login').send({ email: `sadmin_${runId}@crm.com`, password: 'Password@123' });
    superAdminToken = saLogin.body.data.tokens.accessToken;

    const aLogin = await request(app).post('/api/v1/auth/login').send({ email: `admin_${runId}@crm.com`, password: 'Password@123' });
    adminToken = aLogin.body.data.tokens.accessToken;

    const d1Login = await request(app).post('/api/v1/auth/login').send({ email: `dealer1_${runId}@crm.com`, password: 'Password@123' });
    dealer1Token = d1Login.body.data.tokens.accessToken;

    const d2Login = await request(app).post('/api/v1/auth/login').send({ email: `dealer2_${runId}@crm.com`, password: 'Password@123' });
    dealer2Token = d2Login.body.data.tokens.accessToken;

    const agLogin = await request(app).post('/api/v1/auth/login').send({ email: `agent_${runId}@crm.com`, password: 'Password@123' });
    agentToken = agLogin.body.data.tokens.accessToken;

    // 4. Seed Customers
    customer1Id = uuidv4();
    customer2Id = uuidv4();

    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_at, updated_at)
       VALUES
         ($1, $2, 'Customer Amit Kumar', $3, 'Flat 4B, Hill View Apts', 'Mumbai', 'Maharashtra', '400050', 'Bandra', NOW(), NOW()),
         ($4, $5, 'Customer Suresh Nair', $6, 'Flat 12A, Green Park', 'Pune', 'Maharashtra', '411005', 'Shivajinagar', NOW(), NOW())`,
      [
        customer1Id, `CUST_${runId}_1`, `9910${numId}1`,
        customer2Id, `CUST_${runId}_2`, `9910${numId}2`,
      ]
    );
  });

  // ==========================================
  // SECTION A: LOAN APPROVAL & DEALER ISOLATION
  // ==========================================
  describe('Group 1: Loan Approval & Dealer Isolation (Scenarios 1-7)', () => {
    test('1. Dealer submits a loan; it appears in Admin Pending Approvals with originating dealer association', async () => {
      const res = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customerId: customer1Id,
          principalAmount: 30000,
          downPayment: 6000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-15',
          deviceBrand: 'Samsung',
          deviceModel: 'Galaxy A54',
          imei1: `35678901234${numId.slice(-4)}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      loan1Id = res.body.data.id;
      expect(res.body.data.status).toBe('PENDING_APPROVAL');
      expect(res.body.data.dealerId).toBe(dealer1Id);

      // Verify it appears in Admin Pending Approvals
      const pendingRes = await request(app)
        .get('/api/v1/loans/pending-approvals')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(pendingRes.status).toBe(200);
      const found = pendingRes.body.data.find((l: any) => l.id === loan1Id);
      expect(found).toBeDefined();
      expect(found.dealerId).toBe(dealer1Id);
      expect(found.principalAmount).toBe(30000);
      expect(found.downPayment).toBe(6000);
    });

    test('2. Admin approval persists APPROVED status and records audit log', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/loans/${loan1Id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('APPROVED');

      // Verify in DB directly
      const dbCheck = await queryPostgres('SELECT status FROM loans WHERE id = $1', [loan1Id]);
      expect(dbCheck.rows[0].status).toBe('APPROVED');

      const auditCheck = await queryPostgres(
        "SELECT action, user_id FROM audit_logs WHERE entity_id = $1 AND (action = 'LOAN_APPROVED' OR action = 'APPROVE_LOAN')",
        [loan1Id]
      );
      expect(auditCheck.rows.length).toBeGreaterThan(0);
    });

    test('3. Approved loan appears for its originating dealer', async () => {
      const dealerRes = await request(app)
        .get('/api/v1/loans')
        .set('Authorization', `Bearer ${dealer1Token}`);

      expect(dealerRes.status).toBe(200);
      const found = dealerRes.body.data.find((l: any) => l.id === loan1Id);
      expect(found).toBeDefined();
      expect(found.status).toBe('APPROVED');
    });

    test('4. Another dealer cannot view that loan (RLAC / dealer isolation)', async () => {
      const otherDealerRes = await request(app)
        .get(`/api/v1/loans/${loan1Id}`)
        .set('Authorization', `Bearer ${dealer2Token}`);

      expect(otherDealerRes.status).toBe(403);

      const otherListRes = await request(app)
        .get('/api/v1/loans')
        .set('Authorization', `Bearer ${dealer2Token}`);

      expect(otherListRes.status).toBe(200);
      const found = otherListRes.body.data.find((l: any) => l.id === loan1Id);
      expect(found).toBeUndefined();
    });

    test('5. Rejected loans do not create payable entries', async () => {
      // Create a second loan by dealer 1 to reject
      const createRes = await request(app)
        .post('/api/v1/loans')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          customerId: customer1Id,
          principalAmount: 20000,
          downPayment: 4000,
          annualInterestRate: 4.0,
          interestCalcMethod: InterestMethod.FLAT_RATE,
          tenureMonths: 6,
          installmentFrequency: RepaymentFrequency.MONTHLY,
          disbursementDate: '2026-10-15',
        });

      rejectedLoanId = createRes.body.data.id;

      // Reject the loan
      const rejectRes = await request(app)
        .post(`/api/v1/loans/${rejectedLoanId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Incomplete KYC documentation' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('REJECTED');

      // Check eligible loans for dealer payables - rejected loan must NOT be present
      const eligibleRes = await request(app)
        .get(`/api/v1/dealer-payables/dealers/${dealer1Id}/eligible-loans`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(eligibleRes.status).toBe(200);
      const foundRejected = eligibleRes.body.data.find((l: any) => l.loanId === rejectedLoanId);
      expect(foundRejected).toBeUndefined();
    });

    test('6. Approval does not falsely claim a bank transfer occurred', async () => {
      // Check dealer payable payments
      const paymentsRes = await request(app)
        .get(`/api/v1/dealer-payables?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(paymentsRes.status).toBe(200);
      expect(paymentsRes.body.data.totalCount).toBe(0);
    });

    test('7. Approved versus active/disbursed status remains distinct', async () => {
      // Loan 1 is APPROVED, not yet DISBURSED
      const loanRes = await request(app)
        .get(`/api/v1/loans/${loan1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(loanRes.body.data.status).toBe('APPROVED');

      // Now disburse it to make it ACTIVE
      const disburseRes = await request(app)
        .post(`/api/v1/loans/${loan1Id}/disburse`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(disburseRes.status).toBe(200);
      expect(disburseRes.body.data.status).toBe('ACTIVE');
    });
  });

  // ==========================================
  // SECTION B: DEALER PAYABLES (COMPANY TO DEALER)
  // ==========================================
  describe('Group 2: Dealer Payables (Scenarios 8-13)', () => {
    test('8. Eligible disbursement creates one payable entry with netDisbursedAmount', async () => {
      const eligibleRes = await request(app)
        .get(`/api/v1/dealer-payables/dealers/${dealer1Id}/eligible-loans`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(eligibleRes.status).toBe(200);
      const loanEntry = eligibleRes.body.data.find((l: any) => l.loanId === loan1Id);
      expect(loanEntry).toBeDefined();
      // Financed product payable: principalAmount (30000) - downPayment (6000) = 24000 netDisbursedAmount
      expect(loanEntry.netDisbursedAmount).toBe(24000);
      expect(loanEntry.remainingPayable).toBe(24000);
      expect(loanEntry.amountAllocated).toBe(0);
    });

    test('9. Repeated or concurrent retrieval does not duplicate the payable', async () => {
      const [res1, res2] = await Promise.all([
        request(app).get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`).set('Authorization', `Bearer ${adminToken}`),
        request(app).get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`).set('Authorization', `Bearer ${adminToken}`),
      ]);

      expect(res1.body.data.totalPayable).toBe(res2.body.data.totalPayable);
      expect(res1.body.data.dealers[0].totalPayable).toBe(24000);
    });

    test('10. Ineligible loans do not inflate payable totals', async () => {
      const summaryRes = await request(app)
        .get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.status).toBe(200);
      // Total payable should strictly be 24000 from loan1 (rejectedLoanId must NOT be counted)
      expect(summaryRes.body.data.totalPayable).toBe(24000);
      expect(summaryRes.body.data.remainingPayable).toBe(24000);
      expect(summaryRes.body.data.totalPaid).toBe(0);
    });

    test('11. Company payment updates paid and remaining amounts correctly', async () => {
      // Record a company partial payout of ₹10,000 to Dealer 1
      const payRes = await request(app)
        .post('/api/v1/dealer-payables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dealerId: dealer1Id,
          amount: 10000,
          paymentDate: '2026-10-16',
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: 'UTR_TEST_1001',
          notes: 'Batch disbursement payout',
        });

      expect(payRes.status).toBe(201);
      expect(payRes.body.success).toBe(true);
      expect(payRes.body.data.amount).toBe(10000);
      expect(payRes.body.data.payoutNumber).toBeDefined();

      // Check updated summary
      const summaryRes = await request(app)
        .get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.body.data.totalPayable).toBe(24000);
      expect(summaryRes.body.data.totalPaid).toBe(10000);
      expect(summaryRes.body.data.remainingPayable).toBe(14000);
      expect(summaryRes.body.data.dealers[0].payoutStatus).toBe(DealerPayableStatus.PARTIALLY_PAID);
    });

    test('12. Overpayment is rejected by server transaction validation', async () => {
      // Remaining is 14000, attempt to pay 20000
      const overpayRes = await request(app)
        .post('/api/v1/dealer-payables')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dealerId: dealer1Id,
          amount: 20000,
          paymentDate: '2026-10-16',
          paymentMethod: 'BANK_TRANSFER',
        });

      expect(overpayRes.status).toBe(400);
      const errMsg = overpayRes.body.error?.message || overpayRes.body.message || '';
      expect(errMsg).toContain('exceeds the total outstanding payable');
    });

    test('13. Dealer and branch access restrictions are enforced', async () => {
      // Dealer cannot record company payouts (403)
      const dealerAttempt = await request(app)
        .post('/api/v1/dealer-payables')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          dealerId: dealer1Id,
          amount: 1000,
          paymentDate: '2026-10-16',
          paymentMethod: 'CASH',
        });

      expect(dealerAttempt.status).toBe(403);

      // Dealer 2 cannot see Dealer 1 payables
      const d2ViewD1 = await request(app)
        .get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${dealer2Token}`);

      // Dealer isolation ensures Dealer 1 is never visible to Dealer 2
      const foundD1 = d2ViewD1.body.data.dealers?.find((d: any) => d.dealerId === dealer1Id);
      expect(foundD1).toBeUndefined();
    });

    test('13b. Concurrent payout creations execute safely without payout number collision', async () => {
      // Simultaneously record two company payouts of 2000 each
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/dealer-payables')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            dealerId: dealer1Id,
            amount: 2000,
            paymentDate: '2026-10-16',
            paymentMethod: 'BANK_TRANSFER',
            referenceNumber: 'UTR_CONCUR_A',
          }),
        request(app)
          .post('/api/v1/dealer-payables')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            dealerId: dealer1Id,
            amount: 2000,
            paymentDate: '2026-10-16',
            paymentMethod: 'BANK_TRANSFER',
            referenceNumber: 'UTR_CONCUR_B',
          }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.data.payoutNumber).toBeDefined();
      expect(resB.body.data.payoutNumber).toBeDefined();
      expect(resA.body.data.payoutNumber).not.toEqual(resB.body.data.payoutNumber);

      // Reverse both test payouts to verify payout reversal and restore baseline balance for subsequent tests
      const revA = await request(app)
        .post(`/api/v1/dealer-payables/${resA.body.data.id}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Reversing test concurrency payout A' });
      expect(revA.status).toBe(200);

      const revB = await request(app)
        .post(`/api/v1/dealer-payables/${resB.body.data.id}/reverse`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Reversing test concurrency payout B' });
      expect(revB.status).toBe(200);
    });
  });

  // ==========================================
  // SECTION C: DEALER EMI COLLECTIONS
  // ==========================================
  describe('Group 3: Dealer EMI Collections (Scenarios 14-20)', () => {
    let initialOutstanding: number;

    test('14. Dealer-recorded EMI remains pending (PENDING_VERIFICATION) until approval', async () => {
      const loanBefore = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [loan1Id]);
      initialOutstanding = Number(loanBefore.rows[0].outstanding_balance);

      const collectRes = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 4500,
          paymentMode: PaymentMode.CASH,
          paymentDate: '2026-10-17',
          receiptNumber: `RCPT_${runId}_1`,
          notes: 'Customer paid cash at store counter',
        });

      expect(collectRes.status).toBe(201);
      paymentId = collectRes.body.data.id;
      expect(collectRes.body.data.status).toBe(PaymentStatus.PENDING_VERIFICATION);
      expect(collectRes.body.data.collectionSource).toBe(CollectionSource.DEALER);
    });

    test('15. Pending EMI does not change loan balance or EMI schedule', async () => {
      const loanAfter = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanAfter.rows[0].outstanding_balance)).toBe(initialOutstanding);
      expect(Number(loanAfter.rows[0].total_paid)).toBe(0);

      // Verify no installments are marked PAID
      const paidEmis = await queryPostgres("SELECT COUNT(*) FROM emi_installments WHERE loan_id = $1 AND status = 'PAID'", [loan1Id]);
      expect(Number(paidEmis.rows[0].count)).toBe(0);
    });

    test('16. Approval allocates payment exactly once and updates loan balances', async () => {
      const approveRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe(PaymentStatus.SUCCESS);

      // Check loan balances now updated
      const loanUpdated = await queryPostgres('SELECT outstanding_balance, total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanUpdated.rows[0].total_paid)).toBe(4500);
      expect(Number(loanUpdated.rows[0].outstanding_balance)).toBe(initialOutstanding - 4500);
    });

    test('17. Repeated approval does not double-allocate (idempotent)', async () => {
      const repeatRes = await request(app)
        .post(`/api/v1/payments/${paymentId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(repeatRes.status).toBe(200);

      const loanCheck = await queryPostgres('SELECT total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanCheck.rows[0].total_paid)).toBe(4500);
    });

    test('18. Rejection leaves loan balance unchanged', async () => {
      // Record a second collection to reject
      const secondCollect = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 2000,
          paymentMode: PaymentMode.CASH,
          paymentDate: '2026-10-18',
        });

      secondPaymentId = secondCollect.body.data.id;

      const rejectRes = await request(app)
        .post(`/api/v1/payments/${secondPaymentId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Counterfeit note detected' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe(PaymentStatus.REJECTED);

      // Loan total_paid remains 4500
      const loanCheck = await queryPostgres('SELECT total_paid FROM loans WHERE id = $1', [loan1Id]);
      expect(Number(loanCheck.rows[0].total_paid)).toBe(4500);
    });

    test('19. Unauthorized dealer/agent approval returns 403', async () => {
      const thirdCollect = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 1500,
          paymentMode: PaymentMode.CASH,
          paymentDate: '2026-10-19',
        });

      const thirdPaymentId = thirdCollect.body.data.id;

      // Dealer attempts to approve own payment
      const dealerApprove = await request(app)
        .post(`/api/v1/payments/${thirdPaymentId}/approve`)
        .set('Authorization', `Bearer ${dealer1Token}`);

      expect(dealerApprove.status).toBe(403);

      // Agent attempts to approve payment
      const agentApprove = await request(app)
        .post(`/api/v1/payments/${thirdPaymentId}/approve`)
        .set('Authorization', `Bearer ${agentToken}`);

      expect(agentApprove.status).toBe(403);
    });

    test('20. Direct customer payment workflow remains functional without dealer approval bottleneck', async () => {
      const directPay = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          loanId: loan1Id,
          customerId: customer1Id,
          amount: 1000,
          paymentMode: PaymentMode.BANK_TRANSFER,
          paymentDate: '2026-10-19',
          collectionSource: CollectionSource.DIRECT_CUSTOMER,
        });

      expect(directPay.status).toBe(201);
      // Admin/Direct payments succeed immediately
      expect(directPay.body.data.status).toBe(PaymentStatus.SUCCESS);
    });
  });

  // ==========================================
  // SECTION D: COLLECTION SETTLEMENT
  // ==========================================
  describe('Group 4: Collection Settlement (Scenarios 21-26)', () => {
    test('21. Pending and rejected collections are excluded from eligible remittance settlement totals', async () => {
      const unsettledRes = await request(app)
        .get(`/api/v1/dealer-settlements/dealers/${dealer1Id}/unsettled-collections`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(unsettledRes.status).toBe(200);
      expect(unsettledRes.body.data.length).toBeGreaterThan(0);
      const foundApproved = unsettledRes.body.data.find((item: any) => item.paymentId === paymentId);
      expect(foundApproved).toBeDefined();
      const foundRejected = unsettledRes.body.data.find((item: any) => item.paymentId === secondPaymentId);
      expect(foundRejected).toBeUndefined();
    });

    test('22. Approved collections appear in EMI Collections & Settlement ledger endpoint', async () => {
      const collectionsRes = await request(app)
        .get(`/api/v1/dealer-settlements/collections?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(collectionsRes.status).toBe(200);
      expect(collectionsRes.body.success).toBe(true);
      expect(collectionsRes.body.data.records.length).toBeGreaterThan(0);
      expect(collectionsRes.body.data.summary.totalCollectedAmount).toBeGreaterThan(0);
    });

    test('23. Partial and full settlement totals are correct', async () => {
      // Record a remittance settlement of ₹3,000 against Dealer 1 (out of the 4,500 collected)
      const settleRes = await request(app)
        .post('/api/v1/dealer-settlements')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          dealerId: dealer1Id,
          amount: 3000,
          settlementDate: '2026-10-20',
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: 'SETTLE_UTR_001',
          notes: 'Remittance from store cash box',
        });

      expect(settleRes.status).toBe(201);
      expect(settleRes.body.data.amount).toBe(3000);
      expect(settleRes.body.data.status).toBe(SettlementStatus.COMPLETED);

      // Check reconciliation breakdown
      const summaryRes = await request(app)
        .get(`/api/v1/dealer-settlements/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(summaryRes.body.data.totalCollections).toBe(4500);
      expect(summaryRes.body.data.totalSettled).toBe(3000);
      expect(summaryRes.body.data.outstandingSettlement).toBe(1500);
    });

    test('24. Collection settlement does not duplicate the underlying collection', async () => {
      const summaryRes = await request(app)
        .get(`/api/v1/dealer-settlements/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Outstanding + Settled = Total Collections
      const s = summaryRes.body.data;
      expect(s.totalSettled + s.outstandingSettlement).toBe(s.totalCollections);
    });

    test('25. Dealer EMI collections do not silently reduce dealer payables (independent ledgers)', async () => {
      // Verify Dealer Payables is STILL 14000 remaining and not reduced by the 4500 EMI collections
      const payableRes = await request(app)
        .get(`/api/v1/dealer-payables/summary?dealerId=${dealer1Id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(payableRes.body.data.remainingPayable).toBe(14000);
      expect(payableRes.body.data.totalPayable).toBe(24000);
      expect(payableRes.body.data.totalPaid).toBe(10000);
    });

    test('26. Cross-dealer and cross-branch settlement access is denied', async () => {
      // Dealer 1 attempts to create settlement (only admin/manager allowed)
      const dealerCreateSettle = await request(app)
        .post('/api/v1/dealer-settlements')
        .set('Authorization', `Bearer ${dealer1Token}`)
        .send({
          dealerId: dealer1Id,
          amount: 1500,
          settlementDate: '2026-10-20',
          paymentMethod: 'CASH',
        });

      expect(dealerCreateSettle.status).toBe(403);
    });
  });
});
