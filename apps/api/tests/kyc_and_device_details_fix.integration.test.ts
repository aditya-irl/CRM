import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('Regression & Fix Tests: KYC View Access and Customer Device Details (LN-2026-1006)', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  // User identifiers
  let superAdminId: string, superAdminToken: string;
  let adminId: string, adminToken: string;
  let branchManagerId: string, branchManagerToken: string;
  let dealerAUserId: string, dealerAToken: string;
  let dealerBUserId: string, dealerBToken: string;
  let collectionAgentId: string, collectionAgentToken: string;

  // Entities
  let dealerAId: string, dealerACode: string;
  let dealerBId: string, dealerBCode: string;

  let customerAId: string; // Financed by Dealer A
  let customerBId: string; // Financed by Dealer B
  let customerDirectId: string; // Direct customer (no dealer)

  let loanAId: string;
  let loanBId: string;
  let loanDirectId: string;

  let kycDocAId: string;
  let kycDocBId: string;
  let kycDocDirectId: string;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);

    // 1. Create Dealers A and B
    dealerAId = uuidv4();
    dealerACode = `DLR_${runId}_A`.toUpperCase();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, 'Owner A', $4, $5, 'ACTIVE', 'Area A', 'Address A', NOW(), NOW())`,
      [dealerAId, dealerACode, `Store Alpha ${runId}`, `9811${numId}1`, `store_a_${runId}@crm.test`]
    );

    dealerBId = uuidv4();
    dealerBCode = `DLR_${runId}_B`.toUpperCase();
    await queryPostgres(
      `INSERT INTO dealers (id, dealer_code, store_name, owner_name, phone, email, status, area_city, address, created_at, updated_at)
       VALUES ($1, $2, $3, 'Owner B', $4, $5, 'ACTIVE', 'Area B', 'Address B', NOW(), NOW())`,
      [dealerBId, dealerBCode, `Store Beta ${runId}`, `9811${numId}2`, `store_b_${runId}@crm.test`]
    );

    // 2. Create Users
    superAdminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Super Admin User', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())`,
      [superAdminId, `superadmin_${runId}@crm.test`, `9822${numId}1`, hash]
    );

    adminId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Admin User', 'ADMIN', 'ACTIVE', NOW(), NOW())`,
      [adminId, `admin_${runId}@crm.test`, `9822${numId}2`, hash]
    );

    branchManagerId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Branch Manager User', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())`,
      [branchManagerId, `bm_${runId}@crm.test`, `9822${numId}3`, hash]
    );

    dealerAUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User A', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerAUserId, `dealer_a_${runId}@crm.test`, `9822${numId}4`, hash, dealerAId]
    );

    dealerBUserId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, dealer_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Dealer User B', 'DEALER', $5, 'ACTIVE', NOW(), NOW())`,
      [dealerBUserId, `dealer_b_${runId}@crm.test`, `9822${numId}5`, hash, dealerBId]
    );

    collectionAgentId = uuidv4();
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'Collection Agent User', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())`,
      [collectionAgentId, `agent_${runId}@crm.test`, `9822${numId}6`, hash]
    );

    // 3. Customers
    customerAId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer DealerA', $3, '123 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Route 1', $4, NOW(), NOW())`,
      [customerAId, `CUST_${runId}_A`, `9833${numId}1`, dealerAUserId]
    );

    customerBId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer DealerB', $3, '456 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Route 2', $4, NOW(), NOW())`,
      [customerBId, `CUST_${runId}_B`, `9833${numId}2`, dealerBUserId]
    );

    customerDirectId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route, created_by, created_at, updated_at)
       VALUES ($1, $2, 'Customer Direct', $3, '789 Market St', 'Greater Noida', 'Uttar Pradesh', '201310', 'Route 3', $4, NOW(), NOW())`,
      [customerDirectId, `CUST_${runId}_DIR`, `9833${numId}3`, adminId]
    );

    // 4. Loans
    loanAId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date, device_brand, device_model, device_name, imei1, imei2, device_status)
       VALUES ($1, $2, $3, $4, 25000, 3000, 22000, 14.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 4166, 3000, 25000, 0, 25000, 'ACTIVE',
               CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months',
               'Samsung', 'Galaxy A55 5G', 'Samsung Galaxy A55 5G (8GB/128GB)', '860123456789012', '860123456789013', 'ACTIVE')`,
      [loanAId, `LN-A-${runId}`, customerAId, dealerAId]
    );

    loanBId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date, device_brand, device_model, device_name, imei1, imei2, device_status)
       VALUES ($1, $2, $3, $4, 30000, 4000, 26000, 14.00, 'FLAT_RATE', 8, 'MONTHLY', 8, 4250, 4000, 30000, 0, 30000, 'ACTIVE',
               CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '8 months',
               'Xiaomi', 'Redmi Note 13', 'Xiaomi Redmi Note 13 Pro', '861123456789012', '861123456789013', 'ACTIVE')`,
      [loanBId, `LN-B-${runId}`, customerBId, dealerBId]
    );

    loanDirectId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                          annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                          emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                          first_emi_date, maturity_date, device_brand, device_model, device_name, imei1, imei2, device_status)
       VALUES ($1, $2, $3, NULL, 40000, 5000, 35000, 12.00, 'FLAT_RATE', 10, 'MONTHLY', 10, 4400, 4000, 40000, 0, 40000, 'ACTIVE',
               CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '10 months',
               NULL, NULL, NULL, NULL, NULL, NULL)`,
      [loanDirectId, `LN-DIR-${runId}`, customerDirectId]
    );

    // 5. KYC Documents
    kycDocAId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXXXXXX1234', $3, 'image/jpeg', 51200, 'VERIFIED', $4, NOW(), NOW())`,
      [kycDocAId, customerAId, `kyc/${customerAId}/aadhaar_a.jpg`, dealerAUserId]
    );

    kycDocBId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
       VALUES ($1, $2, 'PAN', 'ABCDE****G', $3, 'image/jpeg', 48000, 'VERIFIED', $4, NOW(), NOW())`,
      [kycDocBId, customerBId, `kyc/${customerBId}/pan_b.jpg`, dealerBUserId]
    );

    kycDocDirectId = uuidv4();
    await queryPostgres(
      `INSERT INTO kyc_documents (id, customer_id, doc_type, doc_number_masked, storage_key, file_mime_type, file_size_bytes, status, verified_by, verified_at, created_at)
       VALUES ($1, $2, 'AADHAAR', 'XXXXXXXX9999', $3, 'application/pdf', 90000, 'VERIFIED', $4, NOW(), NOW())`,
      [kycDocDirectId, customerDirectId, `kyc/${customerDirectId}/aadhaar_dir.pdf`, adminId]
    );

    // 6. Tokens
    const loginSuper = await request(app).post('/api/v1/auth/login').send({ email: `superadmin_${runId}@crm.test`, password: 'Password@123' });
    superAdminToken = loginSuper.body.data.tokens.accessToken;

    const loginAdmin = await request(app).post('/api/v1/auth/login').send({ email: `admin_${runId}@crm.test`, password: 'Password@123' });
    adminToken = loginAdmin.body.data.tokens.accessToken;

    const loginBm = await request(app).post('/api/v1/auth/login').send({ email: `bm_${runId}@crm.test`, password: 'Password@123' });
    branchManagerToken = loginBm.body.data.tokens.accessToken;

    const loginDealerA = await request(app).post('/api/v1/auth/login').send({ email: `dealer_a_${runId}@crm.test`, password: 'Password@123' });
    dealerAToken = loginDealerA.body.data.tokens.accessToken;

    const loginDealerB = await request(app).post('/api/v1/auth/login').send({ email: `dealer_b_${runId}@crm.test`, password: 'Password@123' });
    dealerBToken = loginDealerB.body.data.tokens.accessToken;

    const loginAgent = await request(app).post('/api/v1/auth/login').send({ email: `agent_${runId}@crm.test`, password: 'Password@123' });
    collectionAgentToken = loginAgent.body.data.tokens.accessToken;
  });

  afterAll(async () => {
    // Cleanup created test records
    await queryPostgres('DELETE FROM kyc_documents WHERE id IN ($1, $2, $3)', [kycDocAId, kycDocBId, kycDocDirectId]);
    await queryPostgres('DELETE FROM loans WHERE id IN ($1, $2, $3)', [loanAId, loanBId, loanDirectId]);
    await queryPostgres('DELETE FROM customers WHERE id IN ($1, $2, $3)', [customerAId, customerBId, customerDirectId]);
    await queryPostgres("UPDATE users SET status = 'INACTIVE' WHERE id IN ($1, $2, $3, $4, $5, $6)", [
      superAdminId, adminId, branchManagerId, dealerAUserId, dealerBUserId, collectionAgentId
    ]);
    await queryPostgres("UPDATE dealers SET status = 'INACTIVE' WHERE id IN ($1, $2)", [dealerAId, dealerBId]);

    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // ==============================================================
  // ISSUE 1: KYC VIEW ACCESS & RBAC / RLAC
  // ==============================================================
  describe('Issue 1: KYC View Access and Authorization', () => {
    it('1. SUPER_ADMIN can view / download KYC document -> 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('2. ADMIN can view / download KYC document -> 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('3. BRANCH_MANAGER can view / download KYC document -> 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${branchManagerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('4. DEALER can view / download own customer KYC document -> 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBeLessThanOrEqual(300);
    });

    it('5. DEALER cannot view / download another dealer customer KYC -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocBId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });

    it('6. DEALER cannot view / download direct / unrelated customer KYC -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocDirectId}/presigned-download`)
        .set('Authorization', `Bearer ${dealerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });

    it('7. COLLECTION_AGENT is blocked from raw KYC download -> 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`)
        .set('Authorization', `Bearer ${collectionAgentToken}`);

      expect(res.status).toBe(403);
    });

    it('8. Private KYC storage remains secure (unauthenticated access blocked)', async () => {
      const res = await request(app)
        .get(`/api/v1/kyc/${kycDocAId}/presigned-download`);

      expect(res.status).toBe(401);
    });
  });

  // ==============================================================
  // ISSUE 2: CUSTOMER DETAIL & DEVICE DATA MAPPING (LN-2026-1006)
  // ==============================================================
  describe('Issue 2: Customer Detail & Financed Device Mapping for LN-2026-1006', () => {
    it('1. LN-2026-1006 returns the correct financed loan and customer record', async () => {
      // Find the customer for LN-2026-1006
      const loanRow = await queryPostgres(
        `SELECT id, customer_id, device_brand, device_model FROM loans WHERE loan_account_no = 'LN-2026-1006'`
      );
      expect(loanRow.rows.length).toBe(1);
      const customerId = loanRow.rows[0].customer_id;

      const res = await request(app)
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const loans = res.body.data.loans;
      expect(loans).toBeDefined();
      const targetLoan = loans.find((l: any) => l.loanAccountNo === 'LN-2026-1006' || l.loan_account_no === 'LN-2026-1006');
      expect(targetLoan).toBeDefined();

      // 2. Actual device record is returned
      // 3. Actual device name/model/brand is returned
      expect(targetLoan.deviceBrand).toBe('OnePlus');
      expect(targetLoan.deviceModel).toBe('Nord CE4 5G');
      expect(targetLoan.deviceName).toBe('OnePlus Nord CE4 5G (8GB/128GB)');

      // 4. IMEI data is returned
      expect(targetLoan.imei1).toBe('864201061006001');
      expect(targetLoan.imei2).toBe('864201061006002');
      expect(targetLoan.deviceStatus).toBe('ACTIVE');

      // Dual-compatibility checks (snake_case + camelCase)
      expect(targetLoan.device_brand).toBe('OnePlus');
      expect(targetLoan.device_model).toBe('Nord CE4 5G');
      expect(targetLoan.device_name).toBe('OnePlus Nord CE4 5G (8GB/128GB)');
      expect(targetLoan.imei_1).toBe('864201061006001');
      expect(targetLoan.imei_2).toBe('864201061006002');

      // 5. Loan number remains LN-2026-1006
      expect(targetLoan.loanAccountNo).toBe('LN-2026-1006');

      // 6. Financing source is correct
      expect(targetLoan.financingSource).toBe('DEALER');

      // 7. Dealer information is correct where applicable
      expect(targetLoan.dealerStoreName).toBe('Rathore Mobile');

      // 8. Actual device is returned instead of generic "Smart Device"
      expect(targetLoan.deviceBrand).not.toBe('Smart Device');
      expect(targetLoan.deviceName).not.toContain('Asset (LN-2026-1006)');
      expect(targetLoan.deviceModel).not.toBe('Asset (LN-2026-1006)');
    });

    it('9. Loan with genuinely no device returns null device specs without fake "Smart Device"', async () => {
      const res = await request(app)
        .get(`/api/v1/customers/${customerDirectId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const loans = res.body.data.loans;
      const targetLoan = loans.find((l: any) => l.id === loanDirectId);
      expect(targetLoan).toBeDefined();

      // Device fields must be null, not synthetic fake strings
      expect(targetLoan.deviceBrand).toBeNull();
      expect(targetLoan.deviceModel).toBeNull();
      expect(targetLoan.deviceName).toBeNull();
      expect(targetLoan.imei1).toBeNull();
      expect(targetLoan.deviceStatus).toBeNull();

      expect(targetLoan.deviceBrand).not.toBe('Smart Device');
    });

    it('10. Multiple loans/devices map independently to each loan without merging', async () => {
      // Add a 2nd loan with a different device to customerA
      const loanA2Id = uuidv4();
      await queryPostgres(
        `INSERT INTO loans (id, loan_account_no, customer_id, dealer_id, principal_amount, down_payment, net_disbursed_amount,
                            annual_interest_rate, interest_calc_method, tenure_months, installment_frequency, total_installments,
                            emi_amount, total_interest, total_payable, total_paid, outstanding_balance, status, disbursement_date,
                            first_emi_date, maturity_date, device_brand, device_model, device_name, imei1, imei2, device_status)
         VALUES ($1, $2, $3, $4, 18000, 2000, 16000, 14.00, 'FLAT_RATE', 6, 'MONTHLY', 6, 3000, 2000, 18000, 0, 18000, 'ACTIVE',
                 CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month', CURRENT_DATE + INTERVAL '6 months',
                 'Realme', '12 Pro+ 5G', 'Realme 12 Pro+ 5G (12GB/256GB)', '862987654321012', '862987654321013', 'ACTIVE')`,
        [loanA2Id, `LN-A2-${runId}`, customerAId, dealerAId]
      );

      const res = await request(app)
        .get(`/api/v1/customers/${customerAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const loans = res.body.data.loans;
      expect(loans.length).toBe(2);

      const firstLoan = loans.find((l: any) => l.id === loanAId);
      const secondLoan = loans.find((l: any) => l.id === loanA2Id);

      expect(firstLoan).toBeDefined();
      expect(secondLoan).toBeDefined();

      // Loan 1 has Samsung Galaxy A55
      expect(firstLoan.deviceBrand).toBe('Samsung');
      expect(firstLoan.deviceModel).toBe('Galaxy A55 5G');
      expect(firstLoan.imei1).toBe('860123456789012');

      // Loan 2 has Realme 12 Pro+
      expect(secondLoan.deviceBrand).toBe('Realme');
      expect(secondLoan.deviceModel).toBe('12 Pro+ 5G');
      expect(secondLoan.imei1).toBe('862987654321012');

      // Clean up loan 2
      await queryPostgres('DELETE FROM loans WHERE id = $1', [loanA2Id]);
    });
  });
});
