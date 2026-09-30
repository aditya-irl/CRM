import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole, KYCType, PaymentMode } from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';

describe('Production Security & Data Isolation Audit Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;

  // Dealer A
  let dealerAId: string;
  let dealerACode: string;
  let dealerATempPassword: string;
  let dealerAToken: string;
  let dealerAUserId: string;

  // Dealer B
  let dealerBId: string;
  let dealerBCode: string;
  let dealerBTempPassword: string;
  let dealerBToken: string;
  let dealerBUserId: string;

  // Customers & Loans
  let customerAId: string;
  let loanAId: string;
  let paymentAId: string;
  let kycDocAId: string;

  let customerBId: string;
  let loanBId: string;
  let paymentBId: string;
  let kycDocBId: string;

  beforeAll(async () => {
    // 1. Authenticate as Admin
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
        storeName: `SecAudit Store Alpha ${runId}`,
        ownerName: 'Alpha Owner',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: '101 Security Ave',
        areaCity: 'Dadri',
      });
    expect(dealerARes.status).toBe(201);
    dealerAId = dealerARes.body.data.id;
    dealerACode = dealerARes.body.data.dealerCode;

    const dealerALoginRes = await request(app)
      .post(`/api/v1/dealers/${dealerAId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dealerALoginRes.status).toBe(201);
    dealerATempPassword = dealerALoginRes.body.data.temporaryPassword;

    const userARes = await queryPostgres('SELECT id FROM users WHERE dealer_id = $1', [dealerAId]);
    dealerAUserId = userARes.rows[0].id;

    // 3. Create Dealer B
    const dealerBRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `SecAudit Store Beta ${runId}`,
        ownerName: 'Beta Owner',
        phone: `92${Math.floor(10000000 + Math.random() * 90000000)}`,
        address: '202 Security Blvd',
        areaCity: 'Noida',
      });
    expect(dealerBRes.status).toBe(201);
    dealerBId = dealerBRes.body.data.id;
    dealerBCode = dealerBRes.body.data.dealerCode;

    const dealerBLoginRes = await request(app)
      .post(`/api/v1/dealers/${dealerBId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dealerBLoginRes.status).toBe(201);
    dealerBTempPassword = dealerBLoginRes.body.data.temporaryPassword;

    const userBRes = await queryPostgres('SELECT id FROM users WHERE dealer_id = $1', [dealerBId]);
    dealerBUserId = userBRes.rows[0].id;

    // Login Dealer A
    const loginARes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerACode, password: dealerATempPassword });
    expect(loginARes.status).toBe(200);
    dealerAToken = loginARes.body.data.tokens.accessToken;

    // Login Dealer B
    const loginBRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerBCode, password: dealerBTempPassword });
    expect(loginBRes.status).toBe(200);
    dealerBToken = loginBRes.body.data.tokens.accessToken;

    // 4. Create Customer A & Loan A for Dealer A
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
       VALUES ($1, $2, $3, $4, 'Alpha St', 'Dadri', 'UP', '203207', 'Route-A')`,
      [customerAId, `CUST-A-${runId}`, `Borrower Alpha ${runId}`, `911${Math.floor(1000000 + Math.random() * 9000000)}`]
    );

    loanAId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date)
       VALUES ($1, $2, $3, $4, 20000, 2000, 18000, 12.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 3333, 2000, 20000, 0, 20000, 'ACTIVE', CURRENT_DATE,
               CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months')`,
      [loanAId, `LA-A-${runId}`, customerAId, dealerAId]
    );

    // KYC Document A
    kycDocAId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXXXXXX1234', $3, 'image/jpeg', 10240, 'VERIFIED', $4, NOW(), NOW())`,
      [kycDocAId, customerAId, `kyc/${customerAId}/doc-a.jpg`, dealerAUserId]
    );

    // Payment A
    paymentAId = uuidv4();
    await queryPostgres(
      `INSERT INTO payments (id, receipt_number, loan_id, customer_id, amount, payment_mode, collection_source, dealer_id, status, collected_by_agent_id, payment_timestamp)
       VALUES ($1, $2, $3, $4, 2000, 'CASH', 'DEALER', $5, 'SUCCESS', $6, NOW())`,
      [paymentAId, `RCP-A-${runId}`, loanAId, customerAId, dealerAId, dealerAUserId]
    );

    // 5. Create Customer B & Loan B for Dealer B
    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
       VALUES ($1, $2, $3, $4, 'Beta St', 'Noida', 'UP', '201301', 'Route-B')`,
      [customerBId, `CUST-B-${runId}`, `Borrower Beta ${runId}`, `922${Math.floor(1000000 + Math.random() * 9000000)}`]
    );

    loanBId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date)
       VALUES ($1, $2, $3, $4, 25000, 3000, 22000, 14.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 4166, 3000, 25000, 0, 25000, 'ACTIVE', CURRENT_DATE,
               CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months')`,
      [loanBId, `LA-B-${runId}`, customerBId, dealerBId]
    );

    // KYC Document B
    kycDocBId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
       VALUES ($1, $2, 'PAN', 'ABCDE****F', $3, 'image/png', 20480, 'VERIFIED', $4, NOW(), NOW())`,
      [kycDocBId, customerBId, `kyc/${customerBId}/doc-b.png`, dealerBUserId]
    );

    // Payment B
    paymentBId = uuidv4();
    await queryPostgres(
      `INSERT INTO payments (id, receipt_number, loan_id, customer_id, amount, payment_mode, collection_source, dealer_id, status, collected_by_agent_id, payment_timestamp)
       VALUES ($1, $2, $3, $4, 3000, 'UPI', 'DEALER', $5, 'SUCCESS', $6, NOW())`,
      [paymentBId, `RCP-B-${runId}`, loanBId, customerBId, dealerBId, dealerBUserId]
    );
  });

  afterAll(async () => {
    // Cleanup records
    if (paymentAId) await queryPostgres('DELETE FROM payments WHERE id = $1', [paymentAId]);
    if (paymentBId) await queryPostgres('DELETE FROM payments WHERE id = $1', [paymentBId]);
    if (kycDocAId) await queryPostgres('DELETE FROM kyc_documents WHERE id = $1', [kycDocAId]);
    if (kycDocBId) await queryPostgres('DELETE FROM kyc_documents WHERE id = $1', [kycDocBId]);
    if (loanAId) await queryPostgres('DELETE FROM loans WHERE id = $1', [loanAId]);
    if (loanBId) await queryPostgres('DELETE FROM loans WHERE id = $1', [loanBId]);
    if (customerAId) await queryPostgres('DELETE FROM customers WHERE id = $1', [customerAId]);
    if (customerBId) await queryPostgres('DELETE FROM customers WHERE id = $1', [customerBId]);

    if (dealerAUserId) await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [dealerAUserId]);
    if (dealerBUserId) await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id = $1", [dealerBUserId]);
    if (dealerAId) await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id = $1", [dealerAId]);
    if (dealerBId) await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id = $1", [dealerBId]);

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // ==============================================================
  // 1. AUTHENTICATION & PASSWORD MANAGEMENT
  // ==============================================================
  describe('1. Authentication & Password Management', () => {
    it('1.1 Dealer receives mustChangePassword: true upon first login', async () => {
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.mustChangePassword).toBe(true);
    });

    it('1.2 Changing password fails with incorrect current password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({ currentPassword: 'WrongPassword@123', newPassword: 'NewSecurePassword@2026' });

      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/incorrect/i);
    });

    it('1.3 Changing password fails with too short new password (<6 chars)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({ currentPassword: dealerATempPassword, newPassword: '123' });

      expect(res.status).toBe(422);
    });

    it('1.4 Changing password succeeds with valid credentials and clears must_change_password', async () => {
      const newPass = 'UpdatedAlpha@2026#Secure';
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({ currentPassword: dealerATempPassword, newPassword: newPass });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify profile now shows mustChangePassword: false
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.mustChangePassword).toBe(false);

      // Verify login with new password works
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: dealerACode, password: newPass });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.user.mustChangePassword).toBe(false);
      dealerAToken = loginRes.body.data.tokens.accessToken;
    });
  });

  // ==============================================================
  // 2. DOCUMENT & KYC DATA ISOLATION / IDOR PROTECTION
  // ==============================================================
  describe('2. Document & KYC Security', () => {
    it('2.1 Dealer A cannot list KYC documents for Dealer B customer (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/customer/${customerBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('2.2 Dealer A can list KYC documents for their own customer and raw storageKey is stripped', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/customer/${customerAId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      // Raw S3 / filesystem storage key must NOT be leaked to dealers
      expect(res.body.data[0].storageKey).toBeUndefined();
    });

    it('2.3 Customer profile endpoint also strips storageKey for dealers', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.kycDocuments[0].storageKey).toBeUndefined();
    });

    it('2.4 Dealer A cannot generate presigned upload URL for Dealer B customer (returns 403)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/presigned-upload')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: customerBId,
          docType: KYCType.AADHAAR,
          fileName: 'aadhaar_front.jpg',
          mimeType: 'image/jpeg',
          fileSizeBytes: 102400,
        });

      expect(res.status).toBe(403);
    });

    it('2.5 Dealer A cannot confirm KYC document metadata for Dealer B customer (returns 403)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: customerBId,
          docType: KYCType.AADHAAR,
          storageKey: `kyc/${customerBId}/fake-doc.jpg`,
          fileMimeType: 'image/jpeg',
          fileSizeBytes: 102400,
        });

      expect(res.status).toBe(403);
    });

    it('2.6 KYC confirm rejects mismatched storage key path (path traversal defense)', async () => {
      const res = await request(app)
        .post('/api/v1/kyc/confirm')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          customerId: customerAId,
          docType: KYCType.AADHAAR,
          storageKey: `kyc/${customerBId}/other-customer-file.jpg`,
          fileMimeType: 'image/jpeg',
          fileSizeBytes: 102400,
        });

      expect(res.status).toBe(422);
    });

    it('2.7 Dealer A cannot download raw KYC documents (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('2.8 Dealer A cannot delete KYC documents (returns 403)', async () => {
      const res = await request(app)
        .delete(`/api/v1/kyc/${kycDocAId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ==============================================================
  // 3. PAYMENT & COLLECTION DATA ISOLATION / IDOR PROTECTION
  // ==============================================================
  describe('3. Payment & Collection Integrity', () => {
    it('3.1 Dealer A cannot view Dealer B payment receipt (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/receipt/${paymentBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('3.2 Dealer A can view their own payment receipt', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/receipt/${paymentAId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.paymentId).toBe(paymentAId);
    });

    it('3.3 Dealer A cannot view Dealer B payment transaction by ID (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${paymentBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('3.4 Dealer A cannot record payment for Dealer B loan (returns 403)', async () => {
      const res = await request(app)
        .post('/api/v1/payments')
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({
          loanId: loanBId,
          customerId: customerBId,
          amount: 1000,
          paymentMode: PaymentMode.CASH,
        });

      expect(res.status).toBe(403);
    });

    it('3.5 Dealer list payments is strictly scoped to Dealer A and ignores malicious ?dealerId=DealerB', async () => {
      const res = await request(app)
        .get(`/api/v1/payments?dealerId=${dealerBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      // All returned payments must belong exclusively to Dealer A
      for (const p of res.body.data) {
        expect(p.dealerId).toBe(dealerAId);
        expect(p.dealerId).not.toBe(dealerBId);
      }
    });

    it('3.6 Dealer payments summary aggregates strictly Dealer A collections', async () => {
      const res = await request(app)
        .get(`/api/v1/payments/summary?dealerId=${dealerBId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      // Should not aggregate Dealer B's 3000 collection
      expect(res.body.data.sourceBreakdown.dealer.amount).toBe(2000);
    });

    it('3.7 Dealer cannot reverse payments (returns 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentAId}/reverse`)
        .set('Authorization', `Bearer ${dealerAToken}`)
        .send({ reason: 'Unauthorized reversal attempt' });

      expect(res.status).toBe(403);
    });
  });

  // ==============================================================
  // 4. ADMIN BOUNDARIES & RESTRICTED ENDPOINTS
  // ==============================================================
  describe('4. Admin Boundaries & Staff-Only Endpoints', () => {
    it('4.1 Dealer cannot access executive reports dashboard stats (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/dashboard-stats')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.2 Dealer cannot access daily collections report (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/daily-collections')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.3 Dealer cannot access overdue PAR report (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/overdue-par')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.4 Dealer cannot export company-wide reporting data (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export?type=all-collections')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.5 Dealer cannot access agent collections ledger (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/agent-collections')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.6 Dealer cannot access direct collections ledger (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/direct-collections')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.7 Dealer cannot access recovery agent call logs (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/call-logs')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.8 Dealer cannot access agent recovery queue (returns 403)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue')
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });

    it('4.9 Dealer cannot access agent assignments portfolio (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/assignments/agent/${dealerAUserId}`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
    });
  });
});
