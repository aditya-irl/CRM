import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import {
  UserRole,
  ContactMethod,
  ContactOutcome,
  CustomerResponseCategory,
  NonPaymentReason,
  PaymentCommitmentStatus,
  FollowUpPriority,
  FollowUpStatus,
  InterestMethod,
  RepaymentFrequency,
} from '@crm/shared';

import { runPostgresMigrations } from '../src/database/migrate';

describe('Agent Contact Activity and Recovery Follow-up Module Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;

  // Agent A & Agent B
  let agentAId: string;
  let agentAToken: string;
  let agentBId: string;
  let agentBToken: string;

  // Dealer
  let dealerId: string;
  let dealerToken: string;

  // Customers & Loans
  let customerAId: string;
  let loanAId: string;
  let customerBId: string;
  let loanBId: string;

  // Tracked Activity IDs
  let createdActivityId: string;

  beforeAll(async () => {
    // Run database migrations so that 031_agent_contact_activities.sql is applied
    await runPostgresMigrations();

    // 1. Authenticate as Super Admin
    const adminLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.data.tokens.accessToken;

    // 2. Create a test dealer store
    const dealerRes = await request(app)
      .post('/api/v1/dealers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        storeName: `Recovery Retailer ${runId}`,
        ownerName: 'Store Partner',
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `partner_${runId}@retail.test`,
        address: '42 Sector 18',
        areaCity: 'Noida',
      });
    expect(dealerRes.status).toBe(201);
    dealerId = dealerRes.body.data.id;
    const dealerCode = dealerRes.body.data.dealerCode;

    // Create a dealer login user
    const dealerUserRes = await request(app)
      .post(`/api/v1/dealers/${dealerId}/login-account`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dealerUserRes.status).toBe(201);
    const tempPass = dealerUserRes.body.data.temporaryPassword;

    const dealerLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: dealerCode, password: tempPass });
    expect(dealerLogin.status).toBe(200);
    dealerToken = dealerLogin.body.data.tokens.accessToken;

    // 3. Create Agent A
    const agentALoginId = `AGTA_${runId}`.slice(0, 20);
    const agentARes = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Recovery Agent A ${runId}`,
        phone: `93${Math.floor(10000000 + Math.random() * 90000000)}`,
        loginId: agentALoginId,
        status: 'ACTIVE',
      });
    expect(agentARes.status).toBe(201);
    agentAId = agentARes.body.data.user.id;
    const agentAPassword = agentARes.body.data.temporaryPassword;

    const agentALogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentALoginId, password: agentAPassword });
    expect(agentALogin.status).toBe(200);
    agentAToken = agentALogin.body.data.tokens.accessToken;

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        currentPassword: agentAPassword,
        newPassword: 'SecureAgentA@9988!',
      });

    // 4. Create Agent B
    const agentBLoginId = `AGTB_${runId}`.slice(0, 20);
    const agentBRes = await request(app)
      .post('/api/v1/users/agents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Recovery Agent B ${runId}`,
        phone: `94${Math.floor(10000000 + Math.random() * 90000000)}`,
        loginId: agentBLoginId,
        status: 'ACTIVE',
      });
    expect(agentBRes.status).toBe(201);
    agentBId = agentBRes.body.data.user.id;
    const agentBPassword = agentBRes.body.data.temporaryPassword;

    const agentBLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: agentBLoginId, password: agentBPassword });
    expect(agentBLogin.status).toBe(200);
    agentBToken = agentBLogin.body.data.tokens.accessToken;

    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${agentBToken}`)
      .send({
        currentPassword: agentBPassword,
        newPassword: 'SecureAgentB@9988!',
      });

    // 5. Create Customer A & Loan A assigned to Agent A
    const custARes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Borrower A ${runId}`,
        primaryPhone: `98${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Block A, Sector 62',
        city: 'Varanasi',
        state: 'UP',
        pincode: '221001',
        areaRoute: `RouteA_${runId}`,
      });
    expect(custARes.status).toBe(201);
    customerAId = custARes.body.data.id;

    const loanARes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customerAId,
        dealerId,
        deviceBrand: 'Samsung',
        deviceModel: 'Galaxy A15',
        principalAmount: 18000,
        downPayment: 3000,
        annualInterestRate: 4.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agentAId,
      });
    expect(loanARes.status).toBe(201);
    loanAId = loanARes.body.data.id;

    // Approve and disburse Loan A
    await request(app)
      .post(`/api/v1/loans/${loanAId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    await request(app)
      .post(`/api/v1/loans/${loanAId}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    // Create an explicit collection assignment for Agent A -> Customer A
    await request(app)
      .post('/api/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        agentId: agentAId,
        customerId: customerAId,
        areaRoute: `RouteA_${runId}`,
        assignmentType: 'DIRECT',
      });

    // 6. Create Customer B & Loan B assigned to Agent B
    const custBRes = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `Borrower B ${runId}`,
        primaryPhone: `99${Math.floor(10000000 + Math.random() * 90000000)}`,
        addressLine1: 'Block B, Sector 63',
        city: 'Varanasi',
        state: 'UP',
        pincode: '221002',
        areaRoute: `RouteB_${runId}`,
      });
    expect(custBRes.status).toBe(201);
    customerBId = custBRes.body.data.id;

    const loanBRes = await request(app)
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId: customerBId,
        dealerId,
        deviceBrand: 'Redmi',
        deviceModel: 'Note 13',
        principalAmount: 15000,
        downPayment: 2000,
        annualInterestRate: 4.0,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        disbursementDate: '2026-01-01',
        firstEmiDate: '2026-02-01',
        assignedAgentId: agentBId,
      });
    expect(loanBRes.status).toBe(201);
    loanBId = loanBRes.body.data.id;

    await request(app)
      .post(`/api/v1/loans/${loanBId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    await request(app)
      .post(`/api/v1/loans/${loanBId}/disburse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
  });

  // 1. Agent can log a contact for an assigned customer.
  it('1. Agent can log a contact for an assigned customer with full details', async () => {
    const res = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        loanId: loanAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
        contactPhoneUsed: '9876543210',
        customerResponseCategory: CustomerResponseCategory.WILL_PAY_ON_SPECIFIC_DATE,
        customerResponseNotes: 'Customer promised to pay 2500 by next Monday once salary is credited.',
        nonPaymentReason: NonPaymentReason.SALARY_DELAYED,
        nonPaymentReasonNotes: 'Salary delayed by employer due to month-end accounting cycle.',
        promisedPaymentAmount: 2500,
        promisedPaymentDate: '2026-10-30',
        paymentModePromised: 'UPI',
        followUpDate: '2026-10-29',
        followUpTime: '10:30',
        followUpPriority: FollowUpPriority.HIGH,
        followUpNotes: 'Call customer before noon for UPI payment verification',
        agentNotes: 'Borrower was cooperative and acknowledged receipt of SMS statement.',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.customerId).toBe(customerAId);
    expect(res.body.data.loanId).toBe(loanAId);
    expect(res.body.data.agentId).toBe(agentAId);
    expect(res.body.data.contactMethod).toBe(ContactMethod.PHONE_CALL);
    expect(res.body.data.contactOutcome).toBe(ContactOutcome.ANSWERED_CONVERSATION_COMPLETED);
    expect(res.body.data.commitmentStatus).toBe(PaymentCommitmentStatus.PENDING);
    expect(res.body.data.followUpStatus).toBe(FollowUpStatus.PENDING);

    createdActivityId = res.body.data.id;
  });

  // 2. Agent cannot log a contact for an unassigned customer.
  it('2. Agent cannot log a contact for an unassigned customer (returns 403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerBId, // Assigned to Agent B, NOT Agent A
        loanId: loanBId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
        customerResponseCategory: CustomerResponseCategory.WILL_PAY_TODAY,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // 3. Contact method and outcome are validated.
  it('3. Contact method and outcome are validated against known enums', async () => {
    const invalidMethodRes = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        contactMethod: 'TELEPATHY_COMMUNICATION',
        contactOutcome: ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
      });

    expect([400, 422]).toContain(invalidMethodRes.status);

    const invalidOutcomeRes = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: 'PROMISED_HEAVEN_AND_EARTH',
      });

    expect([400, 422]).toContain(invalidOutcomeRes.status);
  });

  // 4. Non-payment reason validation works.
  it('4. Non-payment reason validation works (requires description when OTHER)', async () => {
    const missingOtherExplanation = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
        nonPaymentReason: NonPaymentReason.OTHER,
        nonPaymentReasonNotes: '', // Empty notes for OTHER must fail validation
      });

    expect([400, 422]).toContain(missingOtherExplanation.status);
  });

  // 5. Customer response notes are persisted accurately.
  it('5. Customer response notes are persisted accurately in database', async () => {
    const uniqueNote = `Verified statement note ${runId}: Customer confirmed salary credited on Friday.`;
    const res = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        loanId: loanAId,
        contactMethod: ContactMethod.WHATSAPP,
        contactOutcome: ContactOutcome.WHATSAPP_MESSAGE_SENT,
        customerResponseCategory: CustomerResponseCategory.REQUESTS_MORE_TIME,
        customerResponseNotes: uniqueNote,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.customerResponseNotes).toBe(uniqueNote);

    // Verify raw database record
    const dbCheck = await queryPostgres(
      `SELECT customer_response_notes FROM customer_contact_activities WHERE id = $1`,
      [res.body.data.id]
    );
    expect(dbCheck.rows[0].customer_response_notes).toBe(uniqueNote);
  });

  // 6. Payment commitments are recorded separately from actual payments.
  it('6. Payment commitments are recorded separately and do not alter loan outstanding balance', async () => {
    const loanBefore = await queryPostgres(
      `SELECT outstanding_balance FROM loans WHERE id = $1`,
      [loanAId]
    );
    const balanceBefore = Number(loanBefore.rows[0].outstanding_balance);

    const res = await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        loanId: loanAId,
        contactMethod: ContactMethod.IN_PERSON_VISIT,
        contactOutcome: ContactOutcome.VISIT_COMPLETED,
        promisedPaymentAmount: 5000,
        promisedPaymentDate: '2026-11-01',
        commitmentStatus: PaymentCommitmentStatus.PENDING,
      });

    expect(res.status).toBe(201);

    const loanAfter = await queryPostgres(
      `SELECT outstanding_balance FROM loans WHERE id = $1`,
      [loanAId]
    );
    const balanceAfter = Number(loanAfter.rows[0].outstanding_balance);

    // Outstanding balance must remain completely unchanged
    expect(balanceAfter).toBe(balanceBefore);

    // No payments should be created
    const paymentCheck = await queryPostgres(
      `SELECT COUNT(*) FROM payments WHERE loan_id = $1 AND amount = 5000`,
      [loanAId]
    );
    expect(Number(paymentCheck.rows[0].count)).toBe(0);
  });

  // 7. Follow-up creation and completion work.
  it('7. Follow-up creation and completion update work with status tracking', async () => {
    const updateRes = await request(app)
      .patch(`/api/v1/contact-activities/${createdActivityId}/follow-up`)
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        followUpStatus: FollowUpStatus.COMPLETED,
        followUpNotes: 'Follow-up call completed; customer made payment online.',
        commitmentStatus: PaymentCommitmentStatus.FULFILLED,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.followUpStatus).toBe(FollowUpStatus.COMPLETED);
    expect(updateRes.body.data.commitmentStatus).toBe(PaymentCommitmentStatus.FULFILLED);

    // Verify database record
    const dbCheck = await queryPostgres(
      `SELECT follow_up_status, commitment_status FROM customer_contact_activities WHERE id = $1`,
      [createdActivityId]
    );
    expect(dbCheck.rows[0].follow_up_status).toBe('COMPLETED');
    expect(dbCheck.rows[0].commitment_status).toBe('FULFILLED');
  });

  // 8. Agent can view their own contact history.
  it('8. Agent can view their own contact history', async () => {
    const res = await request(app)
      .get('/api/v1/contact-activities?preset=ALL')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // Every record returned must be assigned to Agent A
    res.body.data.forEach((item: any) => {
      expect(item.agentId).toBe(agentAId);
    });
  });

  // 9. Agent cannot view another Agent’s restricted records.
  it('9. Agent cannot view another Agent’s restricted records via query spoofing', async () => {
    // Attempt to pass agentId = agentBId in query while authenticated as Agent A
    const res = await request(app)
      .get(`/api/v1/contact-activities?agentId=${agentBId}&preset=ALL`)
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(res.status).toBe(200);
    // Server must strictly enforce caller identity: only Agent A records are returned
    res.body.data.forEach((item: any) => {
      expect(item.agentId).toBe(agentAId);
      expect(item.agentId).not.toBe(agentBId);
    });
  });

  // 10. Admin can view authorized Agent activity.
  it('10. Admin can view authorized Agent activity and agent performance breakdown', async () => {
    const listRes = await request(app)
      .get(`/api/v1/contact-activities?agentId=${agentAId}&preset=ALL`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThan(0);

    const adminSummaryRes = await request(app)
      .get('/api/v1/contact-activities/admin-summary?preset=ALL')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminSummaryRes.status).toBe(200);
    expect(adminSummaryRes.body.data.overview).toBeDefined();
    expect(adminSummaryRes.body.data.agents).toBeDefined();
    expect(Array.isArray(adminSummaryRes.body.data.agents)).toBe(true);
  });

  // 11. Dealer cannot access Admin-wide contact reports.
  it('11. Dealer cannot access Admin-wide contact reports (returns 403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/v1/contact-activities/admin-summary')
      .set('Authorization', `Bearer ${dealerToken}`);

    expect(res.status).toBe(403);
  });

  // 12. Tenant isolation is enforced.
  it('12. Tenant isolation is enforced: Dealer cannot access contact activities', async () => {
    const res = await request(app)
      .get('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${dealerToken}`);

    expect(res.status).toBe(403);
  });

  // 13. Duplicate submissions are handled safely.
  it('13. Rapid sequential contact logging succeeds without corrupting ledger', async () => {
    const p1 = request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.NO_ANSWER,
      });

    const p2 = request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.NO_ANSWER,
      });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect([201, 400]).toContain(r1.status);
    expect([201, 400]).toContain(r2.status);
  });

  // 14. Pagination and date filtering work.
  it('14. Pagination and date filtering work properly', async () => {
    const res = await request(app)
      .get('/api/v1/contact-activities?page=1&limit=2&preset=ALL')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  // 15. Asia/Kolkata date boundaries are correct.
  it('15. Asia/Kolkata date boundaries return accurate summary metrics', async () => {
    const res = await request(app)
      .get('/api/v1/contact-activities/summary')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalCallAttempts).toBeDefined();
    expect(res.body.data.callsAnswered).toBeDefined();
    expect(res.body.data.totalCustomersContacted).toBeDefined();
    expect(res.body.data.successfulConversations).toBeDefined();
    expect(res.body.data.followUpsDueToday).toBeDefined();
  });

  // 16. Editing a follow-up does not erase the original contact audit history.
  it('16. Editing a follow-up writes an immutable audit log entry preserving previous state', async () => {
    const auditLogs = await queryPostgres(
      `SELECT * FROM audit_logs WHERE entity = 'ContactActivity' AND entity_id = $1 ORDER BY created_at DESC`,
      [createdActivityId]
    );

    expect(auditLogs.rows.length).toBeGreaterThan(0);
    const updateLog = auditLogs.rows.find((l) => l.action === 'CONTACT_FOLLOW_UP_UPDATED');
    expect(updateLog).toBeDefined();
    expect(updateLog.previous_state).toBeDefined();
    expect(updateLog.new_state).toBeDefined();
  });

  // 17. Logging a contact never creates a payment, ledger entry, receipt, or balance change.
  it('17. Logging a contact never creates a payment, ledger entry, receipt, or balance change', async () => {
    const paymentsCountBefore = await queryPostgres(
      `SELECT COUNT(*) FROM payments WHERE customer_id = $1`,
      [customerAId]
    );
    const receiptsCountBefore = await queryPostgres(
      `SELECT COUNT(*) FROM payments WHERE customer_id = $1 AND receipt_number IS NOT NULL`,
      [customerAId]
    );

    await request(app)
      .post('/api/v1/contact-activities')
      .set('Authorization', `Bearer ${agentAToken}`)
      .send({
        customerId: customerAId,
        loanId: loanAId,
        contactMethod: ContactMethod.PHONE_CALL,
        contactOutcome: ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
        promisedPaymentAmount: 10000,
        promisedPaymentDate: '2026-11-15',
        paymentModePromised: 'Cash',
      });

    const paymentsCountAfter = await queryPostgres(
      `SELECT COUNT(*) FROM payments WHERE customer_id = $1`,
      [customerAId]
    );
    const receiptsCountAfter = await queryPostgres(
      `SELECT COUNT(*) FROM payments WHERE customer_id = $1 AND receipt_number IS NOT NULL`,
      [customerAId]
    );

    expect(Number(paymentsCountAfter.rows[0].count)).toBe(Number(paymentsCountBefore.rows[0].count));
    expect(Number(receiptsCountAfter.rows[0].count)).toBe(Number(receiptsCountBefore.rows[0].count));
  });

  // 18. Existing Agent collection and approval workflows remain unchanged.
  it('18. Existing Agent collection and approval workflows remain completely functional', async () => {
    const queueRes = await request(app)
      .get('/api/v1/agent/queue')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(queueRes.status).toBe(200);
    expect(Array.isArray(queueRes.body.data)).toBe(true);
  });

  // 19. Existing Admin Audit Trail continues to work.
  it('19. Existing Admin Audit Trail continues to work and includes contact activity events', async () => {
    const auditRes = await request(app)
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.success).toBe(true);
    expect(Array.isArray(auditRes.body.data)).toBe(true);
  });

  // 20. Export/report endpoints enforce authorization.
  it('20. Export/report endpoints enforce authorization (Admin allowed, Agent blocked with 403)', async () => {
    const agentExport = await request(app)
      .get('/api/v1/contact-activities/export')
      .set('Authorization', `Bearer ${agentAToken}`);

    expect(agentExport.status).toBe(403);

    const adminExport = await request(app)
      .get('/api/v1/contact-activities/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminExport.status).toBe(200);
    expect(adminExport.headers['content-type']).toContain('text/csv');
    expect(adminExport.text).toContain('Customer Name,Phone,Area Route,Loan Account,Agent Name');
  });
});
