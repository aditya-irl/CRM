import { v4 as uuidv4 } from 'uuid';
import Decimal from 'decimal.js';
import { queryPostgres, runPostgresTransaction } from '../../database/postgres';
import {
  PaymentMode,
  PaymentStatus,
  LoanStatus,
  EMIStatus,
  allocatePaymentWaterfall,
  reversePaymentAllocation,
  computeEmiStatus,
  getBusinessDate,
  UserRole,
} from '@crm/shared';
import { AppError, NotFoundError, ForbiddenError } from '../../middlewares/error.middleware';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';
import { AuditService } from '../audit/audit.service';

export class PaymentService {
  /**
   * Record and atomically allocate a loan payment with PostgreSQL transaction locking,
   * database idempotency, and immutable audit logging.
   */
  public static async recordPayment(
    data: {
      loanId: string;
      emiId?: string | null;
      customerId: string;
      amount: number;
      paymentMode: PaymentMode;
      referenceNumber?: string | null;
      notes?: string | null;
      idempotencyKey?: string;
    },
    user: AuthenticatedUser
  ) {
    if (data.amount <= 0) {
      throw new AppError('Payment amount must be greater than zero');
    }

    // 1. Check Idempotency Key in PostgreSQL before acquiring locks
    if (data.idempotencyKey) {
      const existingRes = await queryPostgres(
        'SELECT id, amount, loan_id, customer_id, payment_mode FROM payments WHERE idempotency_key = $1',
        [data.idempotencyKey]
      );
      if (existingRes.rows.length > 0) {
        const existing = existingRes.rows[0];
        const amountMatches = new Decimal(existing.amount).equals(new Decimal(data.amount));
        const loanMatches = existing.loan_id === data.loanId;
        const customerMatches = existing.customer_id === data.customerId;
        const modeMatches = existing.payment_mode === data.paymentMode;

        if (!amountMatches || !loanMatches || !customerMatches || !modeMatches) {
          throw new AppError(
            `Idempotency key "${data.idempotencyKey}" was previously used with a different payment payload`,
            409
          );
        }

        const receipt = await this.getReceipt(existing.id, user);
        return {
          ...receipt,
          isIdempotentReplay: true,
        };
      }
    }

    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const now = new Date();
    const datePrefix = businessToday.replace(/-/g, '');

    try {
      const result = await runPostgresTransaction(async (client) => {
        // 2. Fetch and Lock Loan row (prevent concurrent payment race conditions)
        const loanRes = await client.query(
          `SELECT id, customer_id, loan_account_no, outstanding_balance, total_paid,
                  total_payable, status, assigned_agent_id
           FROM loans
           WHERE id = $1
           FOR UPDATE`,
          [data.loanId]
        );

        if (loanRes.rows.length === 0) {
          throw new NotFoundError('Loan account not found');
        }

        const loan = loanRes.rows[0];

        if (loan.status !== LoanStatus.ACTIVE) {
          throw new AppError(`Loan is not in an active status for payment collection (current status: ${loan.status})`);
        }

        if (loan.customer_id !== data.customerId) {
          throw new AppError('Customer ID does not match the loan account');
        }

        // 3. Row-Level Access Control (RLAC) for Collection Agents
        if (user.role === UserRole.COLLECTION_AGENT) {
          const isDirectAgent = loan.assigned_agent_id === user.id;
          if (!isDirectAgent) {
            const assignRes = await client.query(
              `SELECT id FROM collection_assignments 
               WHERE agent_id = $1 AND customer_id = $2 AND is_active = TRUE 
               LIMIT 1`,
              [user.id, data.customerId]
            );
            if (assignRes.rows.length === 0) {
              throw new ForbiddenError('You are not authorized to collect payments for this customer or loan');
            }
          }
        }

        // 4. Overpayment Validation against Loan Outstanding
        const loanOutstanding = new Decimal(loan.outstanding_balance);
        const paymentAmount = new Decimal(data.amount);

        if (paymentAmount.greaterThan(loanOutstanding)) {
          throw new AppError(
            `Payment amount ₹${data.amount} exceeds outstanding loan balance ₹${loan.outstanding_balance}`
          );
        }

        // 5. Lock and Fetch all Unpaid Installments for this Loan
        const installmentsRes = await client.query(
          `SELECT id, installment_number, due_date, principal_component, interest_component,
                  expected_amount, paid_amount, remaining_amount, penalty_amount, status
           FROM emi_installments
           WHERE loan_id = $1 AND status != 'PAID'
           ORDER BY installment_number ASC
           FOR UPDATE`,
          [data.loanId]
        );

        const unpaidInstallments = installmentsRes.rows.map((r) => ({
          id: r.id,
          installmentNumber: Number(r.installment_number),
          dueDate: r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : String(r.due_date),
          expectedAmount: Number(r.expected_amount),
          paidAmount: Number(r.paid_amount),
          remainingAmount: Number(r.remaining_amount),
          penaltyAmount: Number(r.penalty_amount),
          status: r.status,
        }));

        // 6. Run Deterministic Waterfall Allocation
        const allocation = allocatePaymentWaterfall(
          data.amount,
          unpaidInstallments,
          loan.outstanding_balance,
          businessToday
        );

        // 7. Generate Atomic Sequential Receipt Number
        const countRes = await client.query(
          `SELECT COUNT(*) as count FROM payments WHERE receipt_number LIKE $1`,
          [`RCP-${datePrefix}-%`]
        );
        const seqNumber = 1001 + parseInt(countRes.rows[0].count, 10);
        const receiptNumber = `RCP-${datePrefix}-${seqNumber}`;
        const paymentId = uuidv4();

        // 8. Insert Payment Record
        const insertSql = `
          INSERT INTO payments (
            id, receipt_number, loan_id, emi_id, customer_id, amount, payment_mode,
            reference_number, collected_by_agent_id, payment_timestamp, status, notes,
            is_reversal, idempotency_key, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'SUCCESS', $10, FALSE, $11, NOW(), NOW())
          RETURNING id, receipt_number, payment_timestamp
        `;

        const primaryEmiId = allocation.allocatedPayments[0]?.emiId || null;
        await client.query(insertSql, [
          paymentId,
          receiptNumber,
          loan.id,
          primaryEmiId,
          data.customerId,
          data.amount,
          data.paymentMode,
          data.referenceNumber || null,
          user.id,
          data.notes || null,
          data.idempotencyKey || null,
        ]);

        // 9. Update each allocated installment
        for (const alloc of allocation.allocatedPayments) {
          await client.query(
            `UPDATE emi_installments
             SET paid_amount = $1, remaining_amount = $2, status = $3,
                 last_payment_date = $4, updated_at = NOW()
             WHERE id = $5`,
            [
              alloc.newPaidAmount,
              alloc.newRemainingAmount,
              alloc.newStatus,
              businessToday,
              alloc.emiId,
            ]
          );
        }

        // 10. Update Loan Balances
        const newTotalPaid = new Decimal(loan.total_paid).plus(paymentAmount).toNumber();
        const newOutstanding = allocation.newLoanOutstanding;
        const newLoanStatus = newOutstanding <= 0 ? LoanStatus.CLOSED : loan.status;

        await client.query(
          `UPDATE loans
           SET total_paid = $1, outstanding_balance = $2, status = $3, updated_at = NOW()
           WHERE id = $4`,
          [newTotalPaid, newOutstanding, newLoanStatus, loan.id]
        );

        // 11. Log Immutable Audit Record inside Transaction
        await AuditService.logWithClient(client, {
          userId: user.id,
          action: 'PAYMENT_COLLECTED',
          entity: 'Payment',
          entityId: paymentId,
          newState: {
            receiptNumber,
            loanId: loan.id,
            loanAccountNo: loan.loan_account_no,
            customerId: data.customerId,
            amount: data.amount,
            allocatedCount: allocation.allocatedPayments.length,
            newLoanOutstanding: newOutstanding,
            newLoanStatus,
          },
        });

        return {
          paymentId,
          receiptNumber,
          loanId: loan.id,
          loanAccountNo: loan.loan_account_no,
          customerId: data.customerId,
          amountCollected: data.amount,
          paymentMode: data.paymentMode,
          referenceNumber: data.referenceNumber || null,
          paymentTimestamp: now.toISOString(),
          allocatedInstallments: allocation.allocatedPayments,
          remainingLoanOutstanding: newOutstanding,
          loanStatus: newLoanStatus,
          isIdempotentReplay: false,
        };
      });

      return result;
    } catch (err: any) {
      // Handle race condition on duplicate idempotency key
      if (err.code === '23505' && data.idempotencyKey && err.constraint?.includes('idempotency')) {
        const existingRes = await queryPostgres(
          'SELECT id, amount, loan_id, customer_id, payment_mode FROM payments WHERE idempotency_key = $1',
          [data.idempotencyKey]
        );
        if (existingRes.rows.length > 0) {
          const existing = existingRes.rows[0];
          const amountMatches = new Decimal(existing.amount).equals(new Decimal(data.amount));
          const loanMatches = existing.loan_id === data.loanId;
          const customerMatches = existing.customer_id === data.customerId;
          const modeMatches = existing.payment_mode === data.paymentMode;

          if (!amountMatches || !loanMatches || !customerMatches || !modeMatches) {
            throw new AppError(
              `Idempotency key "${data.idempotencyKey}" was previously used with a different payment payload`,
              409
            );
          }

          const receipt = await this.getReceipt(existing.id, user);
          return {
            ...receipt,
            isIdempotentReplay: true,
          };
        }
      }
      throw err;
    }
  }

  /**
   * Non-destructive payment reversal with PostgreSQL transaction atomicity,
   * restoring affected EMI installments and loan outstanding balances accurately
   * through active payment ledger re-reconciliation.
   */
  public static async reversePayment(paymentId: string, reason: string, user: AuthenticatedUser) {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');

    const result = await runPostgresTransaction(async (client) => {
      // 1. Fetch and Lock Payment Record
      const payRes = await client.query(
        `SELECT * FROM payments WHERE id = $1 FOR UPDATE`,
        [paymentId]
      );

      if (payRes.rows.length === 0) {
        throw new NotFoundError('Payment not found');
      }

      const payment = payRes.rows[0];

      if (payment.status === PaymentStatus.REVERSED || payment.is_reversal) {
        throw new AppError('This payment is already reversed');
      }

      // 2. Fetch and Lock Loan
      const loanRes = await client.query(
        `SELECT id, loan_account_no, total_paid, outstanding_balance, total_payable, status
         FROM loans
         WHERE id = $1
         FOR UPDATE`,
        [payment.loan_id]
      );

      if (loanRes.rows.length === 0) {
        throw new NotFoundError('Associated loan account not found');
      }

      const loan = loanRes.rows[0];

      // 3. Mark original payment as REVERSED
      await client.query(
        `UPDATE payments
         SET status = 'REVERSED', reversal_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [reason, paymentId]
      );

      // 4. Insert Reversal Audit Record
      const reversalId = uuidv4();
      const reversalReceipt = `REV-${payment.receipt_number}`;

      await client.query(
        `INSERT INTO payments (
          id, receipt_number, loan_id, customer_id, amount, payment_mode,
          collected_by_agent_id, payment_timestamp, status, notes,
          is_reversal, reversed_payment_id, reversal_reason, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'REVERSED', $8, TRUE, $9, $10, NOW(), NOW())`,
        [
          reversalId,
          reversalReceipt,
          loan.id,
          payment.customer_id,
          payment.amount,
          payment.payment_mode,
          user.id,
          `Reversal of ${payment.receipt_number}`,
          paymentId,
          reason,
        ]
      );

      // 5. Calculate remaining active payments on this loan
      const activePaysRes = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric as total_active_paid
         FROM payments
         WHERE loan_id = $1 AND status = 'SUCCESS' AND is_reversal = FALSE`,
        [loan.id]
      );
      const totalActivePaid = new Decimal(activePaysRes.rows[0].total_active_paid);

      // 6. Fetch and Lock all Installments of the Loan
      const instRes = await client.query(
        `SELECT id, installment_number, due_date, expected_amount, paid_amount,
                remaining_amount, penalty_amount, status
         FROM emi_installments
         WHERE loan_id = $1
         ORDER BY installment_number ASC
         FOR UPDATE`,
        [loan.id]
      );

      const allInstallments = instRes.rows.map((r) => ({
        id: r.id,
        installmentNumber: Number(r.installment_number),
        dueDate: r.due_date instanceof Date ? r.due_date.toISOString().slice(0, 10) : String(r.due_date),
        expectedAmount: Number(r.expected_amount),
        paidAmount: 0,
        remainingAmount: Number(r.expected_amount) + Number(r.penalty_amount || 0),
        penaltyAmount: Number(r.penalty_amount || 0),
        status: EMIStatus.UPCOMING,
      }));

      // 7. Re-reconcile active payments across installments
      let reallocatedPayments: any[] = [];
      let newLoanOutstanding = new Decimal(loan.total_payable);

      if (totalActivePaid.greaterThan(0)) {
        const reallocResult = allocatePaymentWaterfall(
          totalActivePaid.toNumber(),
          allInstallments,
          loan.total_payable,
          businessToday
        );
        reallocatedPayments = reallocResult.allocatedPayments;
        newLoanOutstanding = new Decimal(reallocResult.newLoanOutstanding);

        // Also add non-allocated installments with 0 paid
        const allocatedIds = new Set(reallocatedPayments.map((p) => p.emiId));
        for (const inst of allInstallments) {
          if (!allocatedIds.has(inst.id)) {
            const evalResult = computeEmiStatus({
              dueDate: inst.dueDate,
              expectedAmount: inst.expectedAmount,
              paidAmount: 0,
              penaltyAmount: inst.penaltyAmount,
              businessToday,
            });
            reallocatedPayments.push({
              emiId: inst.id,
              installmentNumber: inst.installmentNumber,
              newPaidAmount: 0,
              newRemainingAmount: inst.remainingAmount,
              newStatus: evalResult.status,
            });
          }
        }
      } else {
        reallocatedPayments = allInstallments.map((inst) => {
          const evalResult = computeEmiStatus({
            dueDate: inst.dueDate,
            expectedAmount: inst.expectedAmount,
            paidAmount: 0,
            penaltyAmount: inst.penaltyAmount,
            businessToday,
          });
          return {
            emiId: inst.id,
            installmentNumber: inst.installmentNumber,
            newPaidAmount: 0,
            newRemainingAmount: inst.remainingAmount,
            newStatus: evalResult.status,
          };
        });
      }

      // 8. Update all installments in PostgreSQL
      for (const inst of reallocatedPayments) {
        await client.query(
          `UPDATE emi_installments
           SET paid_amount = $1, remaining_amount = $2, status = $3, updated_at = NOW()
           WHERE id = $4`,
          [
            inst.newPaidAmount,
            inst.newRemainingAmount,
            inst.newStatus,
            inst.emiId,
          ]
        );
      }

      // 9. Update Loan Balances
      const newLoanStatus = newLoanOutstanding.lessThanOrEqualTo(0) ? LoanStatus.CLOSED : LoanStatus.ACTIVE;

      await client.query(
        `UPDATE loans
         SET total_paid = $1, outstanding_balance = $2, status = $3, updated_at = NOW()
         WHERE id = $4`,
        [totalActivePaid.toNumber(), newLoanOutstanding.toNumber(), newLoanStatus, loan.id]
      );

      // 10. Log Reversal Audit Record
      await AuditService.logWithClient(client, {
        userId: user.id,
        action: 'PAYMENT_REVERSED',
        entity: 'Payment',
        entityId: paymentId,
        previousState: {
          amount: Number(payment.amount),
          receiptNumber: payment.receipt_number,
          loanOutstanding: Number(loan.outstanding_balance),
        },
        newState: {
          reversalId,
          reversalReceipt,
          reason,
          restoredOutstanding: newLoanOutstanding.toNumber(),
          restoredTotalPaid: totalActivePaid.toNumber(),
        },
      });

      return {
        success: true,
        reversedPaymentId: paymentId,
        reversalReceipt,
        restoredOutstanding: newLoanOutstanding.toNumber(),
        totalActivePaid: totalActivePaid.toNumber(),
      };
    });

    return result;
  }

  /**
   * Retrieve structured payment receipt with agent RLAC scoping.
   */
  public static async getReceipt(paymentId: string, user: AuthenticatedUser) {
    const sql = `
      SELECT p.*, l.loan_account_no, l.outstanding_balance as current_loan_balance,
             l.assigned_agent_id as loan_agent_id,
             c.full_name as customer_name, c.customer_code, c.primary_phone,
             c.address_line1, c.area_route,
             u.full_name as collected_by_name, u.phone as agent_phone
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      WHERE p.id = $1
    `;

    const res = await queryPostgres(sql, [paymentId]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Receipt not found');
    }

    const payment = res.rows[0];

    // RLAC scoping for agent
    if (user.role === UserRole.COLLECTION_AGENT) {
      const isCollector = payment.collected_by_agent_id === user.id;
      const isLoanAgent = payment.loan_agent_id === user.id;
      if (!isCollector && !isLoanAgent) {
        const assignRes = await queryPostgres(
          `SELECT id FROM collection_assignments 
           WHERE agent_id = $1 AND customer_id = $2 AND is_active = TRUE 
           LIMIT 1`,
          [user.id, payment.customer_id]
        );
        if (assignRes.rows.length === 0) {
          throw new ForbiddenError('You are not authorized to view this receipt');
        }
      }
    }

    return {
      receiptNumber: payment.receipt_number,
      paymentId: payment.id,
      amount: Number(payment.amount),
      paymentMode: payment.payment_mode,
      referenceNumber: payment.reference_number,
      paymentTimestamp: payment.payment_timestamp,
      status: payment.status,
      customer: {
        id: payment.customer_id,
        name: payment.customer_name,
        code: payment.customer_code,
        phone: payment.primary_phone,
        area: payment.area_route,
        address: payment.address_line1,
      },
      loan: {
        id: payment.loan_id,
        accountNo: payment.loan_account_no,
        remainingOutstanding: Number(payment.current_loan_balance),
      },
      collectedBy: {
        id: payment.collected_by_agent_id,
        name: payment.collected_by_name,
        phone: payment.agent_phone,
      },
    };
  }

  /**
   * List payments with pagination, search, and agent portfolio scoping.
   */
  public static async listPayments(
    user: AuthenticatedUser,
    query: { page?: number; limit?: number; loanId?: string; customerId?: string; search?: string }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT p.id, p.receipt_number, p.amount, p.payment_mode, p.reference_number,
             p.payment_timestamp, p.status, p.is_reversal, p.reversal_reason,
             l.id as loan_id, l.loan_account_no,
             c.id as customer_id, c.full_name as customer_name, c.customer_code,
             u.id as collector_id, u.full_name as collected_by_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (user.role === UserRole.COLLECTION_AGENT) {
      sql += ` AND (p.collected_by_agent_id = $${paramIndex} OR l.assigned_agent_id = $${paramIndex} OR c.id IN (
        SELECT customer_id FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE
      ))`;
      params.push(user.id);
      paramIndex++;
    }

    if (query.loanId) {
      sql += ` AND p.loan_id = $${paramIndex++}`;
      params.push(query.loanId);
    }

    if (query.customerId) {
      sql += ` AND p.customer_id = $${paramIndex++}`;
      params.push(query.customerId);
    }

    if (query.search) {
      const s = `%${query.search}%`;
      sql += ` AND (p.receipt_number ILIKE $${paramIndex} OR c.full_name ILIKE $${paramIndex} OR l.loan_account_no ILIKE $${paramIndex})`;
      params.push(s);
      paramIndex++;
    }

    // Total Count
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) sub`;
    const countRes = await queryPostgres<{ total: string }>(countSql, params);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    // Paginated Rows
    sql += ` ORDER BY p.payment_timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const rowsRes = await queryPostgres(sql, params);

    return {
      payments: rowsRes.rows.map((row) => ({
        id: row.id,
        receiptNumber: row.receipt_number,
        loanId: row.loan_id,
        loanAccountNo: row.loan_account_no,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerCode: row.customer_code,
        amount: Number(row.amount),
        paymentMode: row.payment_mode,
        referenceNumber: row.reference_number,
        paymentTimestamp: row.payment_timestamp,
        status: row.status,
        isReversal: row.is_reversal,
        reversalReason: row.reversal_reason,
        collectedBy: {
          id: row.collector_id,
          name: row.collected_by_name,
        },
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
