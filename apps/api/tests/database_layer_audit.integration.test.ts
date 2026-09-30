import request from 'supertest';
import app from '../src/app';
import { v4 as uuidv4 } from 'uuid';
import { queryPostgres, runPostgresTransaction, closePostgresPool } from '../src/database/postgres';
import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';
import { UserRole } from '@crm/shared';

describe('PostgreSQL Database Layer & Financial Integrity Integration Tests', () => {
  const runId = Date.now().toString(36);
  let adminToken: string;
  let testCustomerId: string;
  let testLoanId: string;

  beforeAll(async () => {
    // 1. Authenticate as Admin
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@financecrm.com', password: 'Admin@123456' });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.data.tokens.accessToken;

    // 2. Insert test customer directly for database-level constraint tests
    testCustomerId = uuidv4();
    await queryPostgres(
      `INSERT INTO customers (
        id, customer_code, full_name, primary_phone, address_line1,
        city, state, pincode, area_route, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW())`,
      [
        testCustomerId,
        `CUST-DB-${runId}`,
        'DB Test Customer',
        `92${Math.floor(10000000 + Math.random() * 90000000)}`,
        '101 Database Row',
        'Dadri',
        'UP',
        '203207',
        'Route-DB',
      ]
    );

    // 3. Insert test loan
    testLoanId = uuidv4();
    await queryPostgres(
      `INSERT INTO loans (
        id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
        annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
        total_installments, emi_amount, total_interest, total_payable, total_paid,
        outstanding_balance, disbursement_date, first_emi_date, maturity_date, status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 50000.00, 5000.00, 45000.00,
        12.0000, 'FLAT_RATE', 6, 'MONTHLY',
        6, 8500.00, 6000.00, 51000.00, 0.00,
        51000.00, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 months', 'ACTIVE', NOW(), NOW()
      )`,
      [testLoanId, `LN-DB-${runId}`, testCustomerId]
    );

    // Insert 6 installments
    for (let i = 1; i <= 6; i++) {
      const emiId = uuidv4();
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + i);
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      await queryPostgres(
        `INSERT INTO emi_installments (
          id, loan_id, customer_id, installment_number, due_date,
          expected_amount, remaining_amount, paid_amount, penalty_amount, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5::date, 8500.00, 8500.00, 0.00, 0.00, 'UPCOMING', NOW(), NOW())`,
        [emiId, testLoanId, testCustomerId, i, dueDateStr]
      );
    }
  });

  afterAll(async () => {
    // Note: Due to ON DELETE RESTRICT on loan/customer and immutable audit logs,
    // we close connection pools cleanly without destructive force deletes.
    await closeAllQueues();
    await closeRedisConnection();
    await closePostgresPool();
  });

  // 1. Transaction Atomicity & Rollback Verification
  describe('1. Transaction Atomicity & Rollback', () => {
    test('runPostgresTransaction cleanly rolls back all modifications on error without partial records', async () => {
      const probeCustomerId = uuidv4();
      const probeCode = `CUST-PROBE-${runId}`;

      let caught = false;
      try {
        await runPostgresTransaction(async (client) => {
          await client.query(
            `INSERT INTO customers (
              id, customer_code, full_name, primary_phone, address_line1,
              city, state, pincode, area_route, is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW(), NOW())`,
            [
              probeCustomerId,
              probeCode,
              'Probe Rollback Customer',
              `93${Math.floor(10000000 + Math.random() * 90000000)}`,
              'Rollback Ave',
              'Noida',
              'UP',
              '201301',
              'Route-X',
            ]
          );

          // Force an intentional failure inside the transaction
          throw new Error('INTENTIONAL_ABORT_FOR_TEST');
        });
      } catch (err: any) {
        caught = true;
        expect(err.message).toBe('INTENTIONAL_ABORT_FOR_TEST');
      }

      expect(caught).toBe(true);

      // Verify that probe customer was completely rolled back and does not exist in DB
      const verifyRes = await queryPostgres(
        'SELECT id FROM customers WHERE id = $1',
        [probeCustomerId]
      );
      expect(verifyRes.rows.length).toBe(0);
    });
  });

  // 2. CHECK Constraints & Data Integrity
  describe('2. Database CHECK Constraints', () => {
    test('Rejects loans with negative or zero principal amount', async () => {
      const badLoanId = uuidv4();
      let rejected = false;
      try {
        await queryPostgres(
          `INSERT INTO loans (
            id, loan_account_no, customer_id, principal_amount, down_payment, net_disbursed_amount,
            annual_interest_rate, interest_calc_method, tenure_months, installment_frequency,
            total_installments, emi_amount, total_interest, total_payable, total_paid,
            outstanding_balance, disbursement_date, first_emi_date, maturity_date, status
          ) VALUES (
            $1, $2, $3, -1000.00, 0, 0,
            12.0, 'FLAT_RATE', 6, 'MONTHLY',
            6, 100, 100, 100, 0,
            100, CURRENT_DATE, CURRENT_DATE, CURRENT_DATE, 'ACTIVE'
          )`,
          [badLoanId, `BAD-LN-${runId}`, testCustomerId]
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toContain('violates check constraint');
      }
      expect(rejected).toBe(true);
    });

    test('Rejects payment amount less than or equal to zero', async () => {
      let rejected = false;
      try {
        await queryPostgres(
          `INSERT INTO payments (
            id, receipt_number, loan_id, customer_id, amount, payment_mode,
            collected_by_agent_id, payment_timestamp, status
          ) VALUES ($1, $2, $3, $4, 0.00, 'CASH', (SELECT id FROM users LIMIT 1), NOW(), 'SUCCESS')`,
          [uuidv4(), `BAD-RCP-${runId}`, testLoanId, testCustomerId]
        );
      } catch (err: any) {
        rejected = true;
        expect(err.message).toContain('violates check constraint');
      }
      expect(rejected).toBe(true);
    });
  });

  // 3. Foreign Key & Deletion Integrity (ON DELETE RESTRICT)
  describe('3. Foreign Key & Deletion Protection (ON DELETE RESTRICT)', () => {
    test('Cannot delete a customer that has linked active loans (ON DELETE RESTRICT)', async () => {
      let blocked = false;
      try {
        await queryPostgres('DELETE FROM customers WHERE id = $1', [testCustomerId]);
      } catch (err: any) {
        blocked = true;
        expect(err.message).toContain('violates foreign key constraint');
        expect(err.message).toContain('loans');
      }
      expect(blocked).toBe(true);
    });

    test('Cannot delete a loan that has linked EMI installments (ON DELETE RESTRICT)', async () => {
      let blocked = false;
      try {
        await queryPostgres('DELETE FROM loans WHERE id = $1', [testLoanId]);
      } catch (err: any) {
        blocked = true;
        expect(err.message).toContain('violates foreign key constraint');
        expect(err.message).toContain('emi_installments');
      }
      expect(blocked).toBe(true);
    });
  });

  // 4. Audit Log Immutability Protection
  describe('4. Audit Log Immutability Protection', () => {
    test('Database trigger strictly prevents UPDATE on audit_logs table', async () => {
      // Find an existing audit log
      const auditRes = await queryPostgres('SELECT id FROM audit_logs LIMIT 1');
      if (auditRes.rows.length > 0) {
        const auditId = auditRes.rows[0].id;
        let blocked = false;
        try {
          await queryPostgres(
            `UPDATE audit_logs SET action = 'TAMPERED_ACTION' WHERE id = $1`,
            [auditId]
          );
        } catch (err: any) {
          blocked = true;
          expect(err.message).toContain('Audit logs are strictly immutable');
        }
        expect(blocked).toBe(true);
      }
    });

    test('Database trigger strictly prevents DELETE on audit_logs table', async () => {
      const auditRes = await queryPostgres('SELECT id FROM audit_logs LIMIT 1');
      if (auditRes.rows.length > 0) {
        const auditId = auditRes.rows[0].id;
        let blocked = false;
        try {
          await queryPostgres('DELETE FROM audit_logs WHERE id = $1', [auditId]);
        } catch (err: any) {
          blocked = true;
          expect(err.message).toContain('Audit logs are strictly immutable');
        }
        expect(blocked).toBe(true);
      }
    });
  });

  // 5. Financial Data Types & Exact Precision
  describe('5. Exact Numeric Precision (DECIMAL/NUMERIC without Floating Point Drift)', () => {
    test('PostgreSQL stores loan and EMI numbers as exact NUMERIC(14,2)', async () => {
      const colRes = await queryPostgres(
        `SELECT column_name, data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_name = 'loans' AND column_name IN ('principal_amount', 'emi_amount', 'outstanding_balance')`
      );

      expect(colRes.rows.length).toBe(3);
      for (const row of colRes.rows) {
        expect(row.data_type).toBe('numeric');
        expect(row.numeric_precision).toBe(14);
        expect(row.numeric_scale).toBe(2);
      }
    });

    test('Payments amount is stored as exact NUMERIC(14,2)', async () => {
      const colRes = await queryPostgres(
        `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_name = 'payments' AND column_name = 'amount'`
      );

      expect(colRes.rows.length).toBe(1);
      expect(colRes.rows[0].data_type).toBe('numeric');
      expect(colRes.rows[0].numeric_precision).toBe(14);
      expect(colRes.rows[0].numeric_scale).toBe(2);
    });
  });

  // 6. Chronological Audit Performance Index (Migration 014)
  describe('6. Schema & Migration Index Verification', () => {
    test('Migration 014 chronological index idx_audit_created_at is present in PostgreSQL', async () => {
      const indexRes = await queryPostgres(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs' AND indexname = 'idx_audit_created_at'`
      );

      expect(indexRes.rows.length).toBe(1);
      expect(indexRes.rows[0].indexname).toBe('idx_audit_created_at');
    });

    test('Migration tracker _migrations records all applied migrations sequentially', async () => {
      const migRes = await queryPostgres(
        'SELECT name FROM _migrations ORDER BY id ASC'
      );

      expect(migRes.rows.length).toBeGreaterThanOrEqual(14);
      const names = migRes.rows.map((r) => r.name);
      expect(names).toContain('001_initial_schema.sql');
      expect(names).toContain('006_dealers.sql');
      expect(names).toContain('009_dealer_settlements.sql');
      expect(names).toContain('012_customer_portal_tokens.sql');
      expect(names).toContain('013_dealer_auth.sql');
      expect(names).toContain('014_audit_logs_created_at_index.sql');
    });
  });
});
