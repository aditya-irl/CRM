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
  CollectionSource,
  IPaymentsSummary,
  IPaymentDetail,
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
      collectionSource?: CollectionSource;
      dealerId?: string | null;
      agentId?: string | null;
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
          `SELECT id, customer_id, dealer_id, loan_account_no, outstanding_balance, total_paid,
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

        // 3. Collection Source Validation & Scoping
        let source = data.collectionSource;
        let finalDealerId: string | null = null;
        let finalAgentId: string | null = null;

        if (user.role === UserRole.COLLECTION_AGENT) {
          // Recovery agent can ONLY record RECOVERY_AGENT payments for themselves
          if (source && source !== CollectionSource.RECOVERY_AGENT) {
            throw new ForbiddenError('Collection agents can only record payments through RECOVERY_AGENT source');
          }
          if (data.agentId && data.agentId !== user.id) {
            throw new ForbiddenError('Collection agents cannot record payments on behalf of another agent');
          }
          if (data.dealerId) {
            throw new ForbiddenError('Collection agents cannot record partner store payments');
          }
          source = CollectionSource.RECOVERY_AGENT;
          finalAgentId = user.id;

          // Row-Level Access Control (RLAC) for Collection Agents: must be directly assigned to this loan
          if (!loan.assigned_agent_id || loan.assigned_agent_id !== user.id) {
            throw new ForbiddenError('You are not authorized to collect payments for this customer or loan');
          }
        } else if (user.role === UserRole.DEALER) {
          // Dealer can ONLY record DEALER payments for loans originated from their own store
          if (!user.dealerId) {
            throw new ForbiddenError('Dealer context missing');
          }
          if (loan.dealer_id !== user.dealerId) {
            throw new ForbiddenError('You are not authorized to collect payments for this loan account');
          }
          if (source && source !== CollectionSource.DEALER) {
            throw new ForbiddenError('Partner stores can only record payments through DEALER collection source');
          }
          source = CollectionSource.DEALER;
          finalDealerId = user.dealerId;
          finalAgentId = null;
        } else {
          // Admin / Branch Manager validations
          if (!source) {
            source = CollectionSource.DIRECT_CUSTOMER;
          }

          if (source === CollectionSource.DIRECT_CUSTOMER) {
            if (data.dealerId || data.agentId) {
              throw new AppError('Direct customer payments must not specify dealer or agent');
            }
            finalDealerId = null;
            finalAgentId = null;
          } else if (source === CollectionSource.DEALER) {
            if (!data.dealerId) {
              throw new AppError('Dealer ID is required for partner store payment');
            }
            if (data.agentId) {
              throw new AppError('Agent ID must not be specified for partner store payment');
            }
            const dealerCheck = await client.query(
              `SELECT id, status, store_name, dealer_code FROM dealers WHERE id = $1`,
              [data.dealerId]
            );
            if (dealerCheck.rows.length === 0) {
              throw new NotFoundError('Partner store not found');
            }
            if (dealerCheck.rows[0].status !== 'ACTIVE') {
              throw new AppError('Cannot record payment for an INACTIVE partner store');
            }
            finalDealerId = data.dealerId;
            finalAgentId = null;
          } else if (source === CollectionSource.RECOVERY_AGENT) {
            const targetAgentId = data.agentId;
            if (!targetAgentId) {
              throw new AppError('Agent ID is required for recovery agent payment');
            }
            if (data.dealerId) {
              throw new AppError('Dealer ID must not be specified for recovery agent payment');
            }
            const agentCheck = await client.query(
              `SELECT id, role, full_name, status FROM users WHERE id = $1`,
              [targetAgentId]
            );
            if (agentCheck.rows.length === 0) {
              throw new NotFoundError('Recovery agent not found');
            }
            const agentUser = agentCheck.rows[0];
            if (agentUser.status !== 'ACTIVE' || agentUser.role !== UserRole.COLLECTION_AGENT) {
              throw new AppError('Selected user is not an active collection agent');
            }
            finalAgentId = targetAgentId;
            finalDealerId = null;
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
          dueDate: getBusinessDate(r.due_date, 'Asia/Kolkata'),
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
            collection_source, dealer_id, agent_id,
            reference_number, collected_by_agent_id, payment_timestamp, status, notes,
            is_reversal, idempotency_key, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), 'SUCCESS', $13, FALSE, $14, NOW(), NOW())
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
          source,
          finalDealerId,
          finalAgentId,
          data.referenceNumber || null,
          user.id,
          data.notes || null,
          data.idempotencyKey || null,
        ]);

        // 9. Update each allocated installment and penalties
        for (const alloc of allocation.allocatedPayments) {
          await client.query(
            `UPDATE emi_installments
             SET paid_amount = $1, remaining_amount = $2, penalty_amount = $3, status = $4,
                 last_payment_date = $5, updated_at = NOW()
             WHERE id = $6`,
            [
              alloc.newPaidAmount,
              alloc.newRemainingAmount,
              alloc.remainingPenalty,
              alloc.newStatus,
              businessToday,
              alloc.emiId,
            ]
          );

          // Update individual active penalties in emi_penalties table
          if (alloc.allocatedToPenalty > 0) {
            let remPenaltyToApply = new Decimal(alloc.allocatedToPenalty);
            const pensRes = await client.query(
              `SELECT id, amount, paid_amount, status
               FROM emi_penalties
               WHERE emi_installment_id = $1 AND status = 'ACTIVE'
               ORDER BY created_at ASC
               FOR UPDATE`,
              [alloc.emiId]
            );

            for (const pen of pensRes.rows) {
              if (remPenaltyToApply.lessThanOrEqualTo(0)) break;
              const pAmt = new Decimal(pen.amount);
              const pPaid = new Decimal(pen.paid_amount || 0);
              const pUnpaid = pAmt.minus(pPaid);
              if (pUnpaid.lessThanOrEqualTo(0)) continue;

              const applyAmt = Decimal.min(remPenaltyToApply, pUnpaid);
              const newPaid = pPaid.plus(applyAmt);
              const newStatus = newPaid.greaterThanOrEqualTo(pAmt) ? 'PAID' : 'ACTIVE';

              await client.query(
                `UPDATE emi_penalties
                 SET paid_amount = $1, status = $2, updated_at = NOW()
                 WHERE id = $3`,
                [newPaid.toNumber(), newStatus, pen.id]
              );

              remPenaltyToApply = remPenaltyToApply.minus(applyAmt);
            }
          }
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
            collectionSource: source,
            dealerId: finalDealerId,
            agentId: finalAgentId,
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
          collectionSource: source,
          dealerId: finalDealerId,
          agentId: finalAgentId,
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
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN) {
      throw new ForbiddenError('Only administrators can reverse payments');
    }

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
          collection_source, dealer_id, agent_id,
          collected_by_agent_id, payment_timestamp, status, notes,
          is_reversal, reversed_payment_id, reversal_reason, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), 'REVERSED', $11, TRUE, $12, $13, NOW(), NOW())`,
        [
          reversalId,
          reversalReceipt,
          loan.id,
          payment.customer_id,
          payment.amount,
          payment.payment_mode,
          payment.collection_source || CollectionSource.DIRECT_CUSTOMER,
          payment.dealer_id || null,
          payment.agent_id || null,
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

      // 6. Fetch and Lock all emi_penalties on this loan (ACTIVE or PAID)
      const pensRes = await client.query(
        `SELECT id, emi_installment_id, amount, paid_amount, status
         FROM emi_penalties
         WHERE loan_id = $1 AND status IN ('ACTIVE', 'PAID')
         ORDER BY created_at ASC
         FOR UPDATE`,
        [loan.id]
      );

      // Reset all active/paid penalties to unpaid (0 paid, ACTIVE)
      if (pensRes.rows.length > 0) {
        await client.query(
          `UPDATE emi_penalties
           SET paid_amount = 0, status = 'ACTIVE', updated_at = NOW()
           WHERE loan_id = $1 AND status IN ('ACTIVE', 'PAID')`,
          [loan.id]
        );
      }

      const totalPenByEmi = new Map<string, Decimal>();
      let totalLoanPenalties = new Decimal(0);
      for (const pen of pensRes.rows) {
        const cur = totalPenByEmi.get(pen.emi_installment_id) || new Decimal(0);
        totalPenByEmi.set(pen.emi_installment_id, cur.plus(pen.amount));
        totalLoanPenalties = totalLoanPenalties.plus(pen.amount);
      }

      // 7. Fetch and Lock all Installments of the Loan
      const instRes = await client.query(
        `SELECT id, installment_number, due_date, expected_amount, paid_amount,
                remaining_amount, penalty_amount, status
         FROM emi_installments
         WHERE loan_id = $1
         ORDER BY installment_number ASC
         FOR UPDATE`,
        [loan.id]
      );

      const allInstallments = instRes.rows.map((r) => {
        const fullPen = (totalPenByEmi.get(r.id) || new Decimal(r.penalty_amount || 0)).toNumber();
        return {
          id: r.id,
          installmentNumber: Number(r.installment_number),
          dueDate: getBusinessDate(r.due_date, 'Asia/Kolkata'),
          expectedAmount: Number(r.expected_amount),
          paidAmount: 0,
          remainingAmount: Number(r.expected_amount),
          penaltyAmount: fullPen,
          status: EMIStatus.UPCOMING,
        };
      });

      // 8. Re-reconcile active payments across installments
      const basePayableWithPenalties = new Decimal(loan.total_payable).plus(totalLoanPenalties);
      let reallocatedPayments: any[] = [];
      let newLoanOutstanding = basePayableWithPenalties;

      if (totalActivePaid.greaterThan(0)) {
        const reallocResult = allocatePaymentWaterfall(
          totalActivePaid.toNumber(),
          allInstallments,
          basePayableWithPenalties.toNumber(),
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
              allocatedAmount: 0,
              allocatedToPenalty: 0,
              allocatedToPrincipalInterest: 0,
              remainingPenalty: inst.penaltyAmount,
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
            allocatedAmount: 0,
            allocatedToPenalty: 0,
            allocatedToPrincipalInterest: 0,
            remainingPenalty: inst.penaltyAmount,
            newPaidAmount: 0,
            newRemainingAmount: inst.remainingAmount,
            newStatus: evalResult.status,
          };
        });
      }

      // 9. Update all installments and re-apply penalty allocations in PostgreSQL
      for (const inst of reallocatedPayments) {
        const penAmt = inst.remainingPenalty !== undefined ? inst.remainingPenalty : 0;
        await client.query(
          `UPDATE emi_installments
           SET paid_amount = $1, remaining_amount = $2, penalty_amount = $3, status = $4, updated_at = NOW()
           WHERE id = $5`,
          [
            inst.newPaidAmount,
            inst.newRemainingAmount,
            penAmt,
            inst.newStatus,
            inst.emiId,
          ]
        );

        if (inst.allocatedToPenalty && inst.allocatedToPenalty > 0) {
          let remPenaltyToApply = new Decimal(inst.allocatedToPenalty);
          const activePensRes = await client.query(
            `SELECT id, amount, paid_amount, status
             FROM emi_penalties
             WHERE emi_installment_id = $1 AND status = 'ACTIVE'
             ORDER BY created_at ASC
             FOR UPDATE`,
            [inst.emiId]
          );

          for (const pen of activePensRes.rows) {
            if (remPenaltyToApply.lessThanOrEqualTo(0)) break;
            const pAmt = new Decimal(pen.amount);
            const pPaid = new Decimal(pen.paid_amount || 0);
            const pUnpaid = pAmt.minus(pPaid);
            if (pUnpaid.lessThanOrEqualTo(0)) continue;

            const applyAmt = Decimal.min(remPenaltyToApply, pUnpaid);
            const newPaid = pPaid.plus(applyAmt);
            const newStatus = newPaid.greaterThanOrEqualTo(pAmt) ? 'PAID' : 'ACTIVE';

            await client.query(
              `UPDATE emi_penalties
               SET paid_amount = $1, status = $2, updated_at = NOW()
               WHERE id = $3`,
              [newPaid.toNumber(), newStatus, pen.id]
            );

            remPenaltyToApply = remPenaltyToApply.minus(applyAmt);
          }
        }
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
          collectionSource: payment.collection_source,
          dealerId: payment.dealer_id,
          agentId: payment.agent_id,
        },
        newState: {
          reversalId,
          reversalReceipt,
          reason,
          collectionSource: payment.collection_source,
          dealerId: payment.dealer_id,
          agentId: payment.agent_id,
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
             l.principal_amount as loan_principal,
             l.assigned_agent_id as loan_agent_id,
             l.dealer_id as loan_dealer_id,
             c.full_name as customer_name, c.customer_code, c.primary_phone,
             c.address_line1, c.area_route,
             u.full_name as collected_by_name, u.phone as agent_phone,
             d.store_name as dealer_store_name, d.dealer_code, d.phone as dealer_phone,
             ag.full_name as source_agent_name, ag.phone as source_agent_phone
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      LEFT JOIN dealers d ON p.dealer_id = d.id
      LEFT JOIN users ag ON p.agent_id = ag.id
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
           WHERE agent_id = $1
             AND (customer_id = $2 OR area_route = (SELECT area_route FROM customers WHERE id = $2))
             AND is_active = TRUE
             AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
           LIMIT 1`,
          [user.id, payment.customer_id]
        );
        if (assignRes.rows.length === 0) {
          throw new ForbiddenError('You are not authorized to view this receipt');
        }
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId || (payment.dealer_id !== user.dealerId && payment.loan_dealer_id !== user.dealerId)) {
        throw new ForbiddenError('You are not authorized to view this receipt');
      }
    }

    // Fetch waterfall allocation details from emi_installments
    let allocRows: any[] = [];
    if (payment.emi_id) {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.id = $1`,
        [payment.emi_id]
      );
      allocRows = allocRes.rows;
    } else {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.loan_id = $1 AND e.paid_amount > 0
         ORDER BY e.installment_number ASC`,
        [payment.loan_id]
      );
      allocRows = allocRes.rows;
    }

    const allocations = allocRows.map((a: any) => ({
      id: a.id,
      installmentNumber: Number(a.installment_number),
      principalComponent: Number(a.principal_component),
      interestComponent: Number(a.interest_component),
      penaltyComponent: Number(a.penalty_component),
      totalAmount: Number(a.total_amount),
    }));

    return {
      receiptNumber: payment.receipt_number,
      paymentId: payment.id,
      amount: Number(payment.amount),
      paymentMode: payment.payment_mode,
      collectionSource: payment.collection_source || CollectionSource.DIRECT_CUSTOMER,
      referenceNumber: payment.reference_number,
      paymentTimestamp: payment.payment_timestamp,
      status: payment.status,
      isReversal: Boolean(payment.is_reversal) || payment.status === 'REVERSED',
      reversalReason: payment.reversal_reason,
      notes: payment.notes,
      financeCompany: {
        name: 'Terracotta Finance Ltd.',
        registrationNumber: 'NBFC-KAR-2024-8891',
        supportPhone: '+91 80000 12345',
        email: 'support@terracottafinance.in',
        address: '100 Feet Road, Indiranagar, Bangalore, Karnataka - 560038',
      },
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
        principalAmount: Number(payment.loan_principal || 0),
        remainingOutstanding: Number(payment.current_loan_balance),
        financedDevice: 'Smart Device / Handset',
      },
      dealer: payment.dealer_id ? {
        id: payment.dealer_id,
        storeName: payment.dealer_store_name,
        code: payment.dealer_code,
        phone: payment.dealer_phone,
      } : null,
      agent: payment.agent_id ? {
        id: payment.agent_id,
        name: payment.source_agent_name,
        phone: payment.source_agent_phone,
      } : null,
      collectedBy: {
        id: payment.collected_by_agent_id,
        name: payment.collected_by_name,
        phone: payment.agent_phone,
      },
      allocations,
    };
  }

  /**
   * Retrieve single payment record by ID with complete borrower profile, loan state,
   * waterfall allocation breakdown, reversal audit trail, and lifecycle timeline.
   */
  public static async getPaymentById(paymentId: string, user: AuthenticatedUser): Promise<IPaymentDetail> {
    const sql = `
      SELECT p.*, l.loan_account_no, l.outstanding_balance as current_loan_balance,
             l.principal_amount as loan_principal, l.status as loan_status,
             l.assigned_agent_id as loan_agent_id,
             l.dealer_id as loan_dealer_id,
             c.full_name as customer_name, c.customer_code, c.primary_phone,
             c.address_line1, c.area_route,
             u.full_name as collected_by_name, u.phone as agent_phone,
             d.store_name as dealer_store_name, d.dealer_code, d.phone as dealer_phone,
             ag.full_name as source_agent_name, ag.phone as source_agent_phone
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      LEFT JOIN dealers d ON p.dealer_id = d.id
      LEFT JOIN users ag ON p.agent_id = ag.id
      WHERE p.id = $1
    `;

    const res = await queryPostgres(sql, [paymentId]);
    if (res.rows.length === 0) {
      throw new NotFoundError('Payment transaction not found');
    }

    const p = res.rows[0];

    // RLAC check
    if (user.role === UserRole.COLLECTION_AGENT) {
      const isCollector = p.collected_by_agent_id === user.id;
      const isLoanAgent = p.loan_agent_id === user.id;
      if (!isCollector && !isLoanAgent) {
        const assignRes = await queryPostgres(
          `SELECT id FROM collection_assignments
           WHERE agent_id = $1
             AND (customer_id = $2 OR area_route = (SELECT area_route FROM customers WHERE id = $2))
             AND is_active = TRUE
             AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
           LIMIT 1`,
          [user.id, p.customer_id]
        );
        if (assignRes.rows.length === 0) {
          throw new ForbiddenError('You are not authorized to view this payment');
        }
      }
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId || (p.dealer_id !== user.dealerId && p.loan_dealer_id !== user.dealerId)) {
        throw new ForbiddenError('You are not authorized to view this payment');
      }
    }

    // Fetch waterfall allocation details from emi_installments
    let allocRows: any[] = [];
    if (p.emi_id) {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.id = $1`,
        [p.emi_id]
      );
      allocRows = allocRes.rows;
    } else {
      const allocRes = await queryPostgres(
        `SELECT 
           e.id,
           e.installment_number,
           e.principal_component::numeric as principal_component,
           e.interest_component::numeric as interest_component,
           e.penalty_amount::numeric as penalty_component,
           e.paid_amount::numeric as total_amount
         FROM emi_installments e
         WHERE e.loan_id = $1 AND e.paid_amount > 0
         ORDER BY e.installment_number ASC`,
        [p.loan_id]
      );
      allocRows = allocRes.rows;
    }

    const allocations = allocRows.map((a: any) => ({
      id: a.id,
      installmentNumber: Number(a.installment_number),
      principalComponent: Number(a.principal_component),
      interestComponent: Number(a.interest_component),
      penaltyComponent: Number(a.penalty_component),
      totalAmount: Number(a.total_amount),
    }));

    const isReversed = Boolean(p.is_reversal) || p.status === 'REVERSED';

    // Construct event timeline
    const timeline = [
      {
        event: 'PAYMENT_RECORDED',
        timestamp: p.payment_timestamp,
        description: `Payment of ₹${Number(p.amount).toLocaleString('en-IN')} recorded via ${p.payment_mode} (${p.collection_source})`,
      },
      {
        event: 'WATERFALL_ALLOCATED',
        timestamp: p.payment_timestamp,
        description: `Allocated across ${allocations.length > 0 ? allocations.length : 1} installment(s) per waterfall hierarchy`,
      },
      {
        event: 'RECEIPT_GENERATED',
        timestamp: p.payment_timestamp,
        description: `Official receipt ${p.receipt_number} generated`,
      },
    ];

    if (isReversed) {
      timeline.push({
        event: 'PAYMENT_REVERSED',
        timestamp: p.updated_at || p.payment_timestamp,
        description: `Payment reversed: ${p.reversal_reason || 'Administrative reversal'}`,
      });
    }

    return {
      id: p.id,
      receiptNumber: p.receipt_number,
      loanId: p.loan_id,
      emiId: p.emi_id,
      customerId: p.customer_id,
      customerName: p.customer_name,
      customerCode: p.customer_code,
      customerPhone: p.primary_phone,
      customerAddress: p.address_line1,
      areaRoute: p.area_route,
      loanAccountNo: p.loan_account_no,
      loanPrincipal: Number(p.loan_principal || 0),
      loanOutstanding: Number(p.current_loan_balance),
      loanStatus: p.loan_status,
      financedItem: 'Smart Device / Handset',
      amount: Number(p.amount),
      paymentMode: p.payment_mode as PaymentMode,
      collectionSource: p.collection_source as CollectionSource,
      dealerId: p.dealer_id,
      agentId: p.agent_id,
      dealerStoreName: p.dealer_store_name,
      dealerCode: p.dealer_code,
      agentName: p.source_agent_name,
      referenceNumber: p.reference_number,
      collectedByAgentId: p.collected_by_agent_id,
      paymentTimestamp: p.payment_timestamp,
      status: p.status as PaymentStatus,
      notes: p.notes,
      isReversal: isReversed,
      reversedPaymentId: p.reversed_payment_id,
      reversalReason: p.reversal_reason,
      idempotencyKey: p.idempotency_key,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      customer: {
        id: p.customer_id,
        name: p.customer_name,
        code: p.customer_code,
        phone: p.primary_phone,
        address: p.address_line1,
        route: p.area_route,
      },
      loan: {
        id: p.loan_id,
        accountNo: p.loan_account_no,
        principalAmount: Number(p.loan_principal || 0),
        outstandingBalance: Number(p.current_loan_balance),
        status: p.loan_status,
      },
      dealer: p.dealer_id ? {
        id: p.dealer_id,
        storeName: p.dealer_store_name,
        code: p.dealer_code,
        phone: p.dealer_phone,
      } : null,
      agent: p.agent_id ? {
        id: p.agent_id,
        name: p.source_agent_name,
        phone: p.source_agent_phone,
      } : null,
      allocations,
      reversalAudit: isReversed ? {
        reversedAt: p.updated_at,
        reversedBy: p.collected_by_name,
        reversalReason: p.reversal_reason,
      } : null,
      timeline,
    };
  }

  /**
   * Retrieve aggregate payment metrics and collection channel breakdown across all sources.
   * Active calculations strictly exclude reversed payments.
   */
  public static async getPaymentsSummary(
    user: AuthenticatedUser,
    query: {
      loanId?: string;
      customerId?: string;
      startDate?: string;
      endDate?: string;
      collectionSource?: string;
      search?: string;
      paymentMode?: string;
    } = {}
  ): Promise<IPaymentsSummary> {
    const businessToday = getBusinessDate(undefined, 'Asia/Kolkata');
    const currentMonth = businessToday.slice(0, 7);

    let whereSql = `WHERE (p.status = 'SUCCESS' OR p.status IS NULL) AND (p.is_reversal IS FALSE OR p.is_reversal IS NULL)`;
    const params: any[] = [];
    let paramIndex = 1;

    if (user.role === UserRole.COLLECTION_AGENT) {
      whereSql += ` AND (p.collected_by_agent_id = $${paramIndex} OR l.assigned_agent_id = $${paramIndex} OR c.id IN (
        SELECT customer_id FROM collection_assignments WHERE agent_id = $${paramIndex} AND is_active = TRUE
      ))`;
      params.push(user.id);
      paramIndex++;
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      whereSql += ` AND (p.dealer_id = $${paramIndex} OR l.dealer_id = $${paramIndex})`;
      params.push(user.dealerId);
      paramIndex++;
    }

    if (query.loanId) {
      whereSql += ` AND p.loan_id = $${paramIndex++}`;
      params.push(query.loanId);
    }

    if (query.customerId) {
      whereSql += ` AND p.customer_id = $${paramIndex++}`;
      params.push(query.customerId);
    }

    if (query.collectionSource) {
      whereSql += ` AND p.collection_source = $${paramIndex++}`;
      params.push(query.collectionSource);
    }

    if (query.paymentMode) {
      whereSql += ` AND p.payment_mode = $${paramIndex++}`;
      params.push(query.paymentMode);
    }

    if (query.startDate && query.endDate) {
      whereSql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`;
      params.push(query.startDate, query.endDate);
    } else if (query.startDate) {
      whereSql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex++}::date`;
      params.push(query.startDate);
    } else if (query.endDate) {
      whereSql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex++}::date`;
      params.push(query.endDate);
    }

    if (query.search) {
      const s = `%${query.search}%`;
      whereSql += ` AND (
        c.full_name ILIKE $${paramIndex} OR
        c.primary_phone ILIKE $${paramIndex} OR
        p.receipt_number ILIKE $${paramIndex} OR
        l.loan_account_no ILIKE $${paramIndex} OR
        p.reference_number ILIKE $${paramIndex}
      )`;
      params.push(s);
      paramIndex++;
    }

    const summarySql = `
      SELECT 
        COALESCE(SUM(p.amount), 0)::numeric as total_collections,
        COUNT(p.id)::int as payment_count,
        COALESCE(SUM(CASE WHEN DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex}::date THEN p.amount ELSE 0 END), 0)::numeric as today_collections,
        COUNT(CASE WHEN DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') = $${paramIndex}::date THEN p.id ELSE NULL END)::int as today_count,
        COALESCE(SUM(CASE WHEN TO_CHAR(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $${paramIndex + 1} THEN p.amount ELSE 0 END), 0)::numeric as month_collections,
        COUNT(CASE WHEN TO_CHAR(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = $${paramIndex + 1} THEN p.id ELSE NULL END)::int as month_count,
        COALESCE(SUM(CASE WHEN p.collection_source = 'DIRECT_CUSTOMER' THEN p.amount ELSE 0 END), 0)::numeric as direct_amount,
        COUNT(CASE WHEN p.collection_source = 'DIRECT_CUSTOMER' THEN p.id ELSE NULL END)::int as direct_count,
        COALESCE(SUM(CASE WHEN p.collection_source = 'DEALER' THEN p.amount ELSE 0 END), 0)::numeric as dealer_amount,
        COUNT(CASE WHEN p.collection_source = 'DEALER' THEN p.id ELSE NULL END)::int as dealer_count,
        COALESCE(SUM(CASE WHEN p.collection_source = 'RECOVERY_AGENT' THEN p.amount ELSE 0 END), 0)::numeric as agent_amount,
        COUNT(CASE WHEN p.collection_source = 'RECOVERY_AGENT' THEN p.id ELSE NULL END)::int as agent_count
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      ${whereSql}
    `;
    params.push(businessToday, currentMonth);

    const sumRes = await queryPostgres(summarySql, params);
    const row = sumRes.rows[0] || {};

    const totalAmt = new Decimal(row.total_collections || 0);
    const totalCount = Number(row.payment_count || 0);
    const avgCollection = totalCount > 0 ? totalAmt.dividedBy(totalCount).toDecimalPlaces(2).toNumber() : 0;

    return {
      totalCollections: totalAmt.toNumber(),
      paymentCount: totalCount,
      todayCollections: Number(row.today_collections || 0),
      todayCount: Number(row.today_count || 0),
      monthCollections: Number(row.month_collections || 0),
      monthCount: Number(row.month_count || 0),
      averageCollection: avgCollection,
      sourceBreakdown: {
        directCustomer: {
          amount: Number(row.direct_amount || 0),
          count: Number(row.direct_count || 0),
        },
        dealer: {
          amount: Number(row.dealer_amount || 0),
          count: Number(row.dealer_count || 0),
        },
        recoveryAgent: {
          amount: Number(row.agent_amount || 0),
          count: Number(row.agent_count || 0),
        },
      },
    };
  }

  /**
   * List payments with pagination, search, filters, and agent portfolio scoping.
   */
  public static async listPayments(
    user: AuthenticatedUser,
    query: {
      page?: number;
      limit?: number;
      loanId?: string;
      customerId?: string;
      search?: string;
      collectionSource?: string;
      status?: string;
      paymentMode?: string;
      startDate?: string;
      endDate?: string;
    }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const offset = (page - 1) * limit;

    let sql = `
      SELECT p.id, p.receipt_number, p.amount::numeric, p.payment_mode, p.reference_number,
             p.collection_source, p.dealer_id, p.agent_id, p.notes,
             p.payment_timestamp, p.status, p.is_reversal, p.reversal_reason,
             l.id as loan_id, l.loan_account_no, l.principal_amount as loan_principal,
             l.outstanding_balance as loan_outstanding, l.status as loan_status,
             c.id as customer_id, c.full_name as customer_name, c.customer_code,
             c.primary_phone, c.address_line1, c.area_route,
             u.id as collector_id, u.full_name as collected_by_name,
             d.store_name as dealer_store_name, d.dealer_code,
             ag.full_name as source_agent_name
      FROM payments p
      JOIN loans l ON p.loan_id = l.id
      JOIN customers c ON p.customer_id = c.id
      JOIN users u ON p.collected_by_agent_id = u.id
      LEFT JOIN dealers d ON p.dealer_id = d.id
      LEFT JOIN users ag ON p.agent_id = ag.id
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
    } else if (user.role === UserRole.DEALER) {
      if (!user.dealerId) throw new ForbiddenError('Dealer context missing');
      sql += ` AND (p.dealer_id = $${paramIndex} OR l.dealer_id = $${paramIndex})`;
      params.push(user.dealerId);
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

    if (query.collectionSource) {
      sql += ` AND p.collection_source = $${paramIndex++}`;
      params.push(query.collectionSource);
    }

    if (query.status) {
      sql += ` AND p.status = $${paramIndex++}`;
      params.push(query.status);
    }

    if (query.paymentMode) {
      sql += ` AND p.payment_mode = $${paramIndex++}`;
      params.push(query.paymentMode);
    }

    if (query.startDate && query.endDate) {
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') BETWEEN $${paramIndex++}::date AND $${paramIndex++}::date`;
      params.push(query.startDate, query.endDate);
    } else if (query.startDate) {
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') >= $${paramIndex++}::date`;
      params.push(query.startDate);
    } else if (query.endDate) {
      sql += ` AND DATE(p.payment_timestamp AT TIME ZONE 'Asia/Kolkata') <= $${paramIndex++}::date`;
      params.push(query.endDate);
    }

    if (query.search) {
      const s = `%${query.search}%`;
      sql += ` AND (
        p.receipt_number ILIKE $${paramIndex}
        OR c.full_name ILIKE $${paramIndex}
        OR c.customer_code ILIKE $${paramIndex}
        OR c.primary_phone ILIKE $${paramIndex}
        OR l.loan_account_no ILIKE $${paramIndex}
        OR d.store_name ILIKE $${paramIndex}
        OR ag.full_name ILIKE $${paramIndex}
        OR p.reference_number ILIKE $${paramIndex}
      )`;
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
        loanPrincipal: Number(row.loan_principal || 0),
        loanOutstanding: Number(row.loan_outstanding || 0),
        loanStatus: row.loan_status,
        customerId: row.customer_id,
        customerName: row.customer_name,
        customerCode: row.customer_code,
        customerPhone: row.primary_phone,
        customerAddress: row.address_line1,
        areaRoute: row.area_route,
        amount: Number(row.amount),
        paymentMode: row.payment_mode,
        collectionSource: row.collection_source || CollectionSource.DIRECT_CUSTOMER,
        dealerId: row.dealer_id,
        agentId: row.agent_id,
        dealerStoreName: row.dealer_store_name,
        dealerCode: row.dealer_code,
        agentName: row.source_agent_name,
        referenceNumber: row.reference_number,
        paymentTimestamp: row.payment_timestamp,
        status: row.status,
        isReversal: Boolean(row.is_reversal) || row.status === 'REVERSED',
        reversalReason: row.reversal_reason,
        notes: row.notes,
        collectedByAgentId: row.collector_id,
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

