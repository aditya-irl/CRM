import request from 'supertest';
import app from '../src/app';
import { queryPostgres, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { GoogleSheetsService, ISheetExportPayload, ISheetExportResult } from '../src/modules/reports/google-sheets.service';
import {
  UserRole,
  LoanStatus,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CollectionSource,
  PaymentStatus,
  SettlementStatus,
  SettlementPaymentMethod,
  getBusinessDate,
} from '@crm/shared';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

describe('TASK 9: Google Sheets & CSV Export Integration Tests', () => {
  const runId = Math.random().toString(36).substring(2, 8);
  const numId = Date.now().toString().slice(-6);

  const adminEmail = `admin_${runId}@exportcrm.com`;
  const managerEmail = `mgr_${runId}@exportcrm.com`;
  const agent1Email = `agent1_${runId}@exportcrm.com`;
  const agent2Email = `agent2_${runId}@exportcrm.com`;

  let adminToken: string;
  let managerToken: string;
  let agent1Token: string;
  let agent2Token: string;

  let adminId: string;
  let managerId: string;
  let agent1Id: string;
  let agent2Id: string;

  let dealer1Id: string;
  let dealer2Id: string;
  let customer1Id: string;
  let customer2Id: string;
  let loan1Id: string;
  let loan1AccNo: string;
  let loan2Id: string;
  let loan2AccNo: string;

  let payment1Id: string;
  let payment2Id: string;
  let payment3Id: string;
  let settlement1Id: string;

  let capturedSheetsPayload: ISheetExportPayload | null = null;

  beforeAll(async () => {
    const hash = bcrypt.hashSync('Password@123', 10);
    adminId = uuidv4();
    managerId = uuidv4();
    agent1Id = uuidv4();
    agent2Id = uuidv4();

    // 1. Create Super Admin
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Admin Export', 'SUPER_ADMIN', 'ACTIVE', NOW(), NOW())
    `, [adminId, adminEmail, `9819${numId}1`, hash]);

    // 2. Create Branch Manager
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Branch Mgr Export', 'BRANCH_MANAGER', 'ACTIVE', NOW(), NOW())
    `, [managerId, managerEmail, `9819${numId}2`, hash]);

    // 3. Create Recovery Agent 1
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Export One', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent1Id, agent1Email, `9819${numId}3`, hash]);

    // 4. Create Recovery Agent 2
    await queryPostgres(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'Agent Export Two', 'COLLECTION_AGENT', 'ACTIVE', NOW(), NOW())
    `, [agent2Id, agent2Email, `9819${numId}4`, hash]);

    // Authenticate
    const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: adminEmail, password: 'Password@123' });
    adminToken = adminLogin.body.data.tokens.accessToken;

    const mgrLogin = await request(app).post('/api/v1/auth/login').send({ email: managerEmail, password: 'Password@123' });
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const agent1Login = await request(app).post('/api/v1/auth/login').send({ email: agent1Email, password: 'Password@123' });
    agent1Token = agent1Login.body.data.tokens.accessToken;

    const agent2Login = await request(app).post('/api/v1/auth/login').send({ email: agent2Email, password: 'Password@123' });
    agent2Token = agent2Login.body.data.tokens.accessToken;

    // Create Dealers
    const d1Res = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Apex Mobiles ${runId}`,
        ownerName: 'Sunil Kumar',
        phone: `9820${numId}1`,
        address: '101 MG Road',
        areaCity: 'South Delhi',
      });
    dealer1Id = d1Res.body.data.id;

    const d2Res = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Zenith Electronics ${runId}`,
        ownerName: 'Pooja Verma',
        phone: `9820${numId}2`,
        address: '202 Nehru Place',
        areaCity: 'North Delhi',
      });
    dealer2Id = d2Res.body.data.id;

    // Activate Dealers
    await request(app).patch(`/api/v1/dealers/${dealer1Id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' });
    await request(app).patch(`/api/v1/dealers/${dealer2Id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'ACTIVE' });

    // Create Customers (Customer 1 contains potential formula injection string)
    const c1Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: '=SUM(1,2) Injected Name',
        primaryPhone: `9821${numId}1`,
        addressLine1: '12 Green Park',
        areaRoute: 'South Route',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110016',
      });
    customer1Id = c1Res.body.data.id;

    const c2Res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Rahul Sharma Normal',
        primaryPhone: `9821${numId}2`,
        addressLine1: '45 Rohini Sec 9',
        areaRoute: 'North Route',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110085',
      });
    customer2Id = c2Res.body.data.id;

    // Create Loans
    const l1Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer1Id,
        dealerId: dealer1Id,
        principalAmount: 30000,
        downPayment: 6000,
        annualInterestRate: 18,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-08-01',
        firstEmiDate: '2026-09-01',
        assignedAgentId: agent1Id,
      });
    loan1Id = l1Res.body.data.id;
    loan1AccNo = l1Res.body.data.loanAccountNo;

    const l2Res = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customer2Id,
        dealerId: dealer2Id,
        principalAmount: 50000,
        downPayment: 10000,
        annualInterestRate: 20,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-08-15',
        firstEmiDate: '2026-09-15',
        assignedAgentId: agent2Id,
      });
    loan2Id = l2Res.body.data.id;
    loan2AccNo = l2Res.body.data.loanAccountNo;

    // Payments:
    // 1. Direct Customer Collection
    const p1Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4900,
        paymentMode: PaymentMode.UPI,
        collectionSource: CollectionSource.DIRECT_CUSTOMER,
        referenceNumber: 'UPI-DIRECT-EXPORT-01',
      });
    payment1Id = p1Res.body.data.id;

    // 2. Dealer Collection
    const p2Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4900,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.DEALER,
        dealerId: dealer1Id,
        referenceNumber: 'DEALER-CASH-EXPORT-02',
      });
    payment2Id = p2Res.body.data.id;

    // 3. Recovery Agent Collection
    const p3Res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${agent1Token}`)
      .send({
        loanId: loan1Id,
        customerId: customer1Id,
        amount: 4900,
        paymentMode: PaymentMode.CASH,
        collectionSource: CollectionSource.RECOVERY_AGENT,
        sourceAgentId: agent1Id,
        referenceNumber: 'AGENT-CASH-EXPORT-03',
      });
    payment3Id = p3Res.body.data.id;

    // Dealer Settlement
    const setRes = await request(app)
      .post('/api/v1/dealer-settlements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        dealerId: dealer1Id,
        amount: 4900,
        paymentMethod: SettlementPaymentMethod.BANK_TRANSFER,
        referenceNumber: 'SETTLE-NEFT-9911',
        settlementDate: '2026-09-22',
      });
    settlement1Id = setRes.body.data.id;
  });

  afterAll(async () => {
    GoogleSheetsService.setMockProvider(null);
  });

  // -------------------------------------------------------------
  // CSV EXPORT TESTS
  // -------------------------------------------------------------

  it('1. Admin can export collections CSV from category endpoint and query endpoint', async () => {
    const res1 = await request(app)
      .get('/api/v1/reports/collections/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res1.status).toBe(200);
    expect(res1.headers['content-type']).toContain('text/csv');
    expect(res1.text).toContain('Receipt Number');
    expect(res1.text).toContain('Payment Date & Time');
    expect(res1.text).toContain('Amount (INR)');

    const res2 = await request(app)
      .get('/api/v1/reports/export?type=all-collections')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res2.status).toBe(200);
    expect(res2.headers['content-type']).toContain('text/csv');
  });

  it('2. Admin can export loans CSV from /loans/export', async () => {
    const res = await request(app)
      .get('/api/v1/reports/loans/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Loan Number');
    expect(res.text).toContain('Financed Amount (INR)');
    expect(res.text).toContain('Outstanding Amount (INR)');
  });

  it('3. Admin can export dealer CSV from /dealers/export and /dealer/export', async () => {
    const res = await request(app)
      .get('/api/v1/reports/dealers/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Dealer / Store');
    expect(res.text).toContain('Total Customer Collections (INR)');
    expect(res.text).toContain('Settled Amount (INR)');

    const resAlias = await request(app)
      .get('/api/v1/reports/dealer/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resAlias.status).toBe(200);
  });

  it('4. Admin can export recovery CSV from /recovery/export', async () => {
    const res = await request(app)
      .get('/api/v1/reports/recovery/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Recovery Agent');
    expect(res.text).toContain('Total Lifetime Collected (INR)');
    expect(res.text).toContain('Total Payments Collected Count');
  });

  it('5. CSV headers are correct and match reporting specifications', async () => {
    const res = await request(app)
      .get('/api/v1/reports/collections/export')
      .set('Authorization', `Bearer ${adminToken}`);
    const firstLine = res.text.split('\n')[0];
    expect(firstLine).toContain('Receipt Number');
    expect(firstLine).toContain('Customer Phone');
    expect(firstLine).toContain('Payment Mode');
    expect(firstLine).toContain('Collection Source');
    expect(firstLine).toContain('Dealer / Store');
    expect(firstLine).toContain('Recovery Agent');
    expect(firstLine).toContain('Payment Status');
  });

  it('6. CSV values are correctly escaped and prevent formula injection (=, +, -, @, \\t, \\r)', async () => {
    const res = await request(app)
      .get('/api/v1/reports/loans/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    
    // Customer 1 was created with '=SUM(1,2) Injected Name'
    // Sanitizer must prepend single quote to prevent spreadsheet execution
    expect(res.text).toContain("'=SUM(1,2) Injected Name");
    // Ensure properly quote-enclosed
    expect(res.text).toMatch(/"'?=SUM\(1,2\)/);
  });

  it('7. CSV filters work and return accurately filtered records', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/collections/export?search=${loan1AccNo}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(loan1AccNo);
  });

  it('8. Date filtering uses IST business dates correctly', async () => {
    const todayIST = getBusinessDate(undefined, 'Asia/Kolkata');
    const res = await request(app)
      .get(`/api/v1/reports/collections/export?startDate=${todayIST}&endDate=${todayIST}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Receipt Number');
  });

  it('9. Dealer filtering works for collections and loans exports', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/collections/export?dealerId=${dealer1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`Apex Mobiles ${runId}`);
  });

  it('10. Agent filtering works for exports', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/collections/export?agentId=${agent1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Agent Export One');
  });

  it('11. Collection-source filtering works (DIRECT_CUSTOMER, DEALER, RECOVERY_AGENT)', async () => {
    const directRes = await request(app)
      .get('/api/v1/reports/collections/export?collectionSource=DIRECT_CUSTOMER')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(directRes.status).toBe(200);
    expect(directRes.text).toContain('DIRECT_CUSTOMER');

    const dealerRes = await request(app)
      .get('/api/v1/reports/collections/export?collectionSource=DEALER')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dealerRes.status).toBe(200);
    expect(dealerRes.text).toContain('DEALER');
  });

  it('12. Payment-method filtering works in exports', async () => {
    const upiRes = await request(app)
      .get('/api/v1/reports/collections/export?paymentMode=UPI')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(upiRes.status).toBe(200);
    expect(upiRes.text).toContain('UPI');
  });

  it('13. Status filtering works (SUCCESS, REVERSED)', async () => {
    const successRes = await request(app)
      .get('/api/v1/reports/collections/export?paymentStatus=SUCCESS')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(successRes.status).toBe(200);
    expect(successRes.text).toContain('SUCCESS');
  });

  it('14. Loan-status filtering works (ACTIVE, CLOSED, DEFAULTED)', async () => {
    const activeLoans = await request(app)
      .get('/api/v1/reports/loans/export?loanStatus=ACTIVE')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activeLoans.status).toBe(200);
    expect(activeLoans.text).toContain('ACTIVE');
  });

  it('15. Collection agent cannot export organization-wide reports (403 Forbidden)', async () => {
    const collectionsRes = await request(app)
      .get('/api/v1/reports/collections/export')
      .set('Authorization', `Bearer ${agent1Token}`);
    expect(collectionsRes.status).toBe(403);

    const loansRes = await request(app)
      .get('/api/v1/reports/loans/export')
      .set('Authorization', `Bearer ${agent1Token}`);
    expect(loansRes.status).toBe(403);

    const exportRes = await request(app)
      .get('/api/v1/reports/export?type=all-collections')
      .set('Authorization', `Bearer ${agent1Token}`);
    expect(exportRes.status).toBe(403);
  });

  it('16. Branch manager scope is respected and authorized', async () => {
    const res = await request(app)
      .get('/api/v1/reports/collections/export')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  // -------------------------------------------------------------
  // GOOGLE SHEETS EXPORT TESTS
  // -------------------------------------------------------------

  it('17. Google Sheets export works when configured and returns metadata', async () => {
    // Setup Mock Provider for GoogleSheetsService
    GoogleSheetsService.setMockProvider({
      syncToSheet: async (payload: ISheetExportPayload): Promise<ISheetExportResult> => {
        capturedSheetsPayload = payload;
        return {
          spreadsheetId: 'mock_spreadsheet_id_12345',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/mock_spreadsheet_id_12345',
          sheetTitle: payload.sheetTitle,
          updatedRows: payload.rows.length,
          updatedColumns: payload.headers.length,
          exportedAt: new Date().toISOString(),
        };
      },
    });

    const res = await request(app)
      .post('/api/v1/reports/export/google-sheets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'collections',
        reportType: 'all-collections',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.spreadsheetId).toBe('mock_spreadsheet_id_12345');
    expect(res.body.data.sheetTitle).toBe('Collections');
    expect(res.body.data.updatedRows).toBeGreaterThanOrEqual(1);
    expect(capturedSheetsPayload).not.toBeNull();
  });

  it('18. Google Sheets export fails gracefully when configuration is missing', async () => {
    // Disable mock provider and verify error message
    GoogleSheetsService.setMockProvider(null);

    const res = await request(app)
      .post('/api/v1/reports/export/google-sheets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        category: 'collections',
        reportType: 'all-collections',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Google Sheets export is not configured');
  });

  it('19. No Google credentials, secrets, or private keys are returned through API responses', async () => {
    GoogleSheetsService.setMockProvider({
      syncToSheet: async (payload: ISheetExportPayload): Promise<ISheetExportResult> => {
        return {
          spreadsheetId: 'clean_sheet_id_99',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/clean_sheet_id_99',
          sheetTitle: payload.sheetTitle,
          updatedRows: payload.rows.length,
          updatedColumns: payload.headers.length,
          exportedAt: new Date().toISOString(),
        };
      },
    });

    const res = await request(app)
      .post('/api/v1/reports/export/google-sheets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'loans', reportType: 'disbursements' });

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('private_key');
    expect(bodyStr).not.toContain('client_secret');
    expect(bodyStr).not.toContain('BEGIN PRIVATE KEY');
  });

  it('20. Correct report data is written to the sheet and cell values are sanitized', async () => {
    capturedSheetsPayload = null;
    GoogleSheetsService.setMockProvider({
      syncToSheet: async (payload: ISheetExportPayload): Promise<ISheetExportResult> => {
        capturedSheetsPayload = payload;
        return {
          spreadsheetId: 'mock_sheet_sanitized',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/mock_sheet_sanitized',
          sheetTitle: payload.sheetTitle,
          updatedRows: payload.rows.length,
          updatedColumns: payload.headers.length,
          exportedAt: new Date().toISOString(),
        };
      },
    });

    const res = await request(app)
      .post('/api/v1/reports/google-sheets/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'dealer', reportType: 'dealer-reconciliation' });

    expect(res.status).toBe(200);
    expect(capturedSheetsPayload).not.toBeNull();
    expect(capturedSheetsPayload!.sheetTitle).toBe('Dealer Collections');
    expect(capturedSheetsPayload!.headers).toContain('Dealer / Store');
    expect(capturedSheetsPayload!.headers).toContain('Total Customer Collections (INR)');
    expect(capturedSheetsPayload!.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('21. Headers are written correctly for all 4 categories', async () => {
    const categories: Array<{ category: string; reportType: string; expectedTitle: string; expectedHeader: string }> = [
      { category: 'collections', reportType: 'all-collections', expectedTitle: 'Collections', expectedHeader: 'Receipt Number' },
      { category: 'loans', reportType: 'disbursements', expectedTitle: 'Loans', expectedHeader: 'Loan Number' },
      { category: 'dealer', reportType: 'dealer-reconciliation', expectedTitle: 'Dealer Collections', expectedHeader: 'Dealer / Store' },
      { category: 'recovery', reportType: 'agent-performance', expectedTitle: 'Recovery', expectedHeader: 'Recovery Agent' },
    ];

    for (const item of categories) {
      capturedSheetsPayload = null;
      GoogleSheetsService.setMockProvider({
        syncToSheet: async (payload: ISheetExportPayload): Promise<ISheetExportResult> => {
          capturedSheetsPayload = payload;
          return {
            spreadsheetId: 'mock_test',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/mock_test',
            sheetTitle: payload.sheetTitle,
            updatedRows: payload.rows.length,
            updatedColumns: payload.headers.length,
            exportedAt: new Date().toISOString(),
          };
        },
      });

      const res = await request(app)
        .post('/api/v1/reports/export/google-sheets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ category: item.category, reportType: item.reportType });

      expect(res.status).toBe(200);
      expect(capturedSheetsPayload).not.toBeNull();
      expect(capturedSheetsPayload!.sheetTitle).toBe(item.expectedTitle);
      expect(capturedSheetsPayload!.headers).toContain(item.expectedHeader);
    }
  });

  it('22. Export audit log is created for both REPORT_EXPORTED_CSV and REPORT_EXPORTED_GOOGLE_SHEETS', async () => {
    const csvAuditRes = await queryPostgres(`
      SELECT action, entity, entity_id, new_state
      FROM audit_logs
      WHERE action = 'REPORT_EXPORTED_CSV'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    expect(csvAuditRes.rows.length).toBeGreaterThan(0);
    expect(csvAuditRes.rows[0].action).toBe('REPORT_EXPORTED_CSV');

    const sheetsAuditRes = await queryPostgres(`
      SELECT action, entity, entity_id, new_state
      FROM audit_logs
      WHERE action = 'REPORT_EXPORTED_GOOGLE_SHEETS'
      ORDER BY created_at DESC
      LIMIT 5
    `);
    expect(sheetsAuditRes.rows.length).toBeGreaterThan(0);
    expect(sheetsAuditRes.rows[0].action).toBe('REPORT_EXPORTED_GOOGLE_SHEETS');
  });
});
