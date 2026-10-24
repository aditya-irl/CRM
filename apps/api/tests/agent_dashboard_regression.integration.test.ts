import request from 'supertest';
import app from '../src/app';
import { queryPostgres } from '../src/database/postgres';
import { UserRole, UserStatus, LoanStatus, PaymentMode, CollectionSource, PaymentStatus } from '@crm/shared';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/middlewares/auth.middleware';
import { v4 as uuidv4 } from 'uuid';

describe('Regression Tests: Agent Dashboard and Queue Validations', () => {
  const runId = Math.random().toString(36).substring(2, 8);

  const agent1Id = uuidv4();
  const agent2Id = uuidv4();
  const adminId = uuidv4();
  const dealerId = uuidv4();
  const dealerUserId = uuidv4();

  const customer1Id = uuidv4();
  const customer2Id = uuidv4();

  const loan1Id = uuidv4();
  const loan2Id = uuidv4();

  const emi1Id = uuidv4();
  const emi2Id = uuidv4();

  let agent1Token: string;
  let agent2Token: string;
  let adminToken: string;
  let dealerToken: string;

  beforeAll(async () => {
    // 1. Create Users
    await queryPostgres(
      `INSERT INTO users (id, email, phone, password_hash, full_name, role, status)
       VALUES 
         ($1, $2, $3, 'hash', 'Reg Agent One', 'COLLECTION_AGENT', 'ACTIVE'),
         ($4, $5, $6, 'hash', 'Reg Agent Two', 'COLLECTION_AGENT', 'ACTIVE'),
         ($7, $8, $9, 'hash', 'Reg Admin User', 'SUPER_ADMIN', 'ACTIVE'),
         ($10, $11, $12, 'hash', 'Reg Dealer User', 'DEALER', 'ACTIVE')`,
      [
        agent1Id, `ag1_${runId}@crm.test`, `910000${Math.floor(1000 + Math.random() * 9000)}`,
        agent2Id, `ag2_${runId}@crm.test`, `910001${Math.floor(1000 + Math.random() * 9000)}`,
        adminId, `adm_${runId}@crm.test`, `910002${Math.floor(1000 + Math.random() * 9000)}`,
        dealerUserId, `dlr_${runId}@crm.test`, `910003${Math.floor(1000 + Math.random() * 9000)}`,
      ]
    );

    // 2. Create Dealer
    await queryPostgres(
      `INSERT INTO dealers (id, store_name, dealer_code, owner_name, email, phone, address, area_city, status)
       VALUES ($1, 'Reg Store', $2, 'Reg Owner', $3, $4, 'Test Address 123', 'Delhi', 'ACTIVE')`,
      [dealerId, `DLR-${runId.toUpperCase()}`, `store_${runId}@crm.test`, `920000${Math.floor(1000 + Math.random() * 9000)}`]
    );
    await queryPostgres(`UPDATE users SET dealer_id = $1 WHERE id = $2`, [dealerId, dealerUserId]);

    // 3. Create Customers
    await queryPostgres(
      `INSERT INTO customers (id, customer_code, full_name, primary_phone, address_line1, city, state, pincode, area_route)
       VALUES 
         ($1, $2, 'Customer Agent One', '9300000001', 'Street 1', 'Delhi', 'Delhi', '110001', 'North Route'),
         ($3, $4, 'Customer Agent Two', '9300000002', 'Street 2', 'Delhi', 'Delhi', '110001', 'South Route')`,
      [customer1Id, `CUST-A1-${runId}`, customer2Id, `CUST-A2-${runId}`]
    );

    // 4. Create Loans assigned to Agent 1 vs Agent 2
    await queryPostgres(
      `INSERT INTO loans (
         id, loan_account_no, customer_id, dealer_id, principal_amount, net_disbursed_amount,
         annual_interest_rate, tenure_months, emi_amount, total_installments,
         total_interest, total_payable, outstanding_balance, disbursement_date, first_emi_date, maturity_date,
         status, assigned_agent_id, created_by
       )
       VALUES 
         ($1, $2, $3, $4, 10000, 9500, 10, 2, 5500, 2, 1000, 11000, 11000, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + INTERVAL '2 months', 'ACTIVE', $5, $6),
         ($7, $8, $9, $4, 10000, 9500, 10, 2, 5500, 2, 1000, 11000, 11000, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + INTERVAL '2 months', 'ACTIVE', $10, $6)`,
      [
        loan1Id, `LN-A1-${runId}`, customer1Id, dealerId, agent1Id, adminId,
        loan2Id, `LN-A2-${runId}`, customer2Id, agent2Id,
      ]
    );

    // 5. Create EMIs
    await queryPostgres(
      `INSERT INTO emi_installments (id, loan_id, customer_id, installment_number, due_date, expected_amount, paid_amount, remaining_amount, status)
       VALUES 
         ($1, $2, $3, 1, CURRENT_DATE, 5500, 0, 5500, 'DUE_TODAY'),
         ($4, $5, $6, 1, CURRENT_DATE, 5500, 0, 5500, 'DUE_TODAY')`,
      [emi1Id, loan1Id, customer1Id, emi2Id, loan2Id, customer2Id]
    );

    // 6. Sign JWTs
    agent1Token = jwt.sign({ id: agent1Id, email: `ag1_${runId}@crm.test`, role: UserRole.COLLECTION_AGENT }, JWT_SECRET, { expiresIn: '1h' });
    agent2Token = jwt.sign({ id: agent2Id, email: `ag2_${runId}@crm.test`, role: UserRole.COLLECTION_AGENT }, JWT_SECRET, { expiresIn: '1h' });
    adminToken = jwt.sign({ id: adminId, email: `adm_${runId}@crm.test`, role: UserRole.SUPER_ADMIN }, JWT_SECRET, { expiresIn: '1h' });
    dealerToken = jwt.sign({ id: dealerUserId, email: `dlr_${runId}@crm.test`, role: UserRole.DEALER, dealerId }, JWT_SECRET, { expiresIn: '1h' });
  });

  describe('Agent Queue Endpoint (/api/v1/emi/queue)', () => {
    it('1. Authenticated Agent can call /api/v1/emi/queue without query parameters (returns 200)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
      // Scoped only to Agent 1's assignment
      const itemIds = res.body.items.map((i: any) => i.installmentId);
      expect(itemIds).toContain(emi1Id);
      expect(itemIds).not.toContain(emi2Id);
    });

    it('2. Authenticated Agent can call /api/v1/emi/queue? with trailing empty query string (returns 200)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue?')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('3. Authenticated Agent can call /api/v1/emi/queue with empty string query params (returns 200)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/queue?status=&route=&search=')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const itemIds = res.body.items.map((i: any) => i.installmentId);
      expect(itemIds).toContain(emi1Id);
    });
  });

  describe('Agent Dashboard Endpoint (/api/v1/emi/agent-dashboard)', () => {
    it('4. Authenticated Agent can call /api/v1/emi/agent-dashboard without query parameters (returns 200)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.agent.id).toBe(agent1Id);
      expect(res.body.data.assignedCustomers).toBe(1);
      expect(res.body.data.activeLoans).toBe(1);
      expect(res.body.data.todayDue).toBe(5500);
      expect(res.body.data.todayDueCount).toBe(1);
    });

    it('5. Agent Dashboard metrics remain strictly isolated per agent', async () => {
      const res2 = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${agent2Token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.agent.id).toBe(agent2Id);
      expect(res2.body.data.assignedCustomers).toBe(1);
      expect(res2.body.data.activeLoans).toBe(1);
    });
  });

  describe('Validation & Authorization Constraints', () => {
    it('6. Invalid UUID identifier in required parameter path returns 400 Bad Request', async () => {
      const res = await request(app)
        .get('/api/v1/emi/not-a-valid-uuid/penalties')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('7. Unauthenticated request to /queue returns 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/emi/queue');
      expect(res.status).toBe(401);
    });

    it('8. Dealer cannot access Agent Dashboard (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/emi/agent-dashboard')
        .set('Authorization', `Bearer ${dealerToken}`);

      expect(res.status).toBe(403);
    });

    it('9. Collection Agent cannot access Dealer Payables (returns 403 Forbidden)', async () => {
      const res = await request(app)
        .get('/api/v1/dealer-payables')
        .set('Authorization', `Bearer ${agent1Token}`);

      expect(res.status).toBe(403);
    });
  });
});
