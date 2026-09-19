import { queryPostgres, runPostgresTransaction } from '../database/postgres';
import { db } from '../database/db';
import { getBusinessDate, computeEmiStatus, EMIStatus } from '@crm/shared';
import { AuditService } from '../modules/audit/audit.service';

export interface DailyTransitionResult {
  executedForDate: string;
  totalEvaluated: number;
  dueTodayUpdated: number;
  overdueUpdated: number;
  paidCorrected: number;
  agingRefreshed: number;
  unchanged: number;
}

export class EMIStateEngineJob {
  /**
   * Execute daily EMI state transitions and overdue aging updates in PostgreSQL.
   * Runs deterministically with Asia/Kolkata timezone interpretation.
   * Fully idempotent and concurrency-safe using row-level locking (FOR UPDATE SKIP LOCKED).
   */
  public static async runDailyTransition(simulatedDate?: string): Promise<DailyTransitionResult> {
    const businessToday = getBusinessDate(simulatedDate, 'Asia/Kolkata');
    console.log(`[EMIStateEngineJob] Running daily state transition for Asia/Kolkata date: ${businessToday}`);

    let totalEvaluated = 0;
    let dueTodayUpdated = 0;
    let overdueUpdated = 0;
    let paidCorrected = 0;
    let agingRefreshed = 0;
    let unchanged = 0;

    const batchSize = 200;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batchResult = await runPostgresTransaction(async (client) => {
        // 1. Fetch batch with row-level locking (SKIP LOCKED prevents worker collisions)
        const fetchSql = `
          SELECT e.id, e.due_date, e.expected_amount, e.paid_amount, e.remaining_amount,
                 e.penalty_amount, e.status, e.days_overdue, e.loan_id, e.customer_id
          FROM emi_installments e
          JOIN loans l ON e.loan_id = l.id
          WHERE l.status = 'ACTIVE'
            AND (e.status != 'PAID' OR e.paid_amount >= e.expected_amount)
          ORDER BY e.due_date ASC, e.id ASC
          LIMIT $1 OFFSET $2
          FOR UPDATE SKIP LOCKED
        `;

        const res = await client.query(fetchSql, [batchSize, offset]);
        const rows = res.rows;

        if (rows.length === 0) {
          return { done: true, stats: { evaluated: 0, dueToday: 0, overdue: 0, paid: 0, aging: 0, unchanged: 0 } };
        }

        let bDueToday = 0;
        let bOverdue = 0;
        let bPaid = 0;
        let bAging = 0;
        let bUnchanged = 0;

        for (const row of rows) {
          const evalResult = computeEmiStatus({
            dueDate: getBusinessDate(row.due_date, 'Asia/Kolkata'),
            expectedAmount: Number(row.expected_amount),
            paidAmount: Number(row.paid_amount),
            remainingAmount: Number(row.remaining_amount),
            penaltyAmount: Number(row.penalty_amount),
            businessToday,
          });

          const currentStatus = row.status as EMIStatus;
          const currentDaysOverdue = Number(row.days_overdue);

          const statusChanged = currentStatus !== evalResult.status;
          const agingChanged = currentDaysOverdue !== evalResult.daysOverdue;

          if (!statusChanged && !agingChanged) {
            bUnchanged++;
            continue;
          }

          // 2. Perform targeted update
          await client.query(
            `UPDATE emi_installments
             SET status = $1, days_overdue = $2, remaining_amount = $3, updated_at = NOW()
             WHERE id = $4`,
            [evalResult.status, evalResult.daysOverdue, evalResult.remainingAmount, row.id]
          );

          if (evalResult.status === EMIStatus.DUE_TODAY && currentStatus !== EMIStatus.DUE_TODAY) {
            bDueToday++;
            await AuditService.log({
              action: 'EMI_MARKED_DUE',
              entity: 'EMIInstallment',
              entityId: row.id,
              previousState: { status: currentStatus, daysOverdue: currentDaysOverdue },
              newState: { status: evalResult.status, daysOverdue: evalResult.daysOverdue, businessToday },
            });
          } else if (evalResult.status === EMIStatus.OVERDUE && currentStatus !== EMIStatus.OVERDUE) {
            bOverdue++;
            await AuditService.log({
              action: 'EMI_MARKED_OVERDUE',
              entity: 'EMIInstallment',
              entityId: row.id,
              previousState: { status: currentStatus, daysOverdue: currentDaysOverdue },
              newState: { status: evalResult.status, daysOverdue: evalResult.daysOverdue, businessToday },
            });
          } else if (evalResult.status === EMIStatus.PAID && currentStatus !== EMIStatus.PAID) {
            bPaid++;
          } else if (agingChanged) {
            bAging++;
          }
        }

        return {
          done: rows.length < batchSize,
          stats: {
            evaluated: rows.length,
            dueToday: bDueToday,
            overdue: bOverdue,
            paid: bPaid,
            aging: bAging,
            unchanged: bUnchanged,
          },
        };
      });

      totalEvaluated += batchResult.stats.evaluated;
      dueTodayUpdated += batchResult.stats.dueToday;
      overdueUpdated += batchResult.stats.overdue;
      paidCorrected += batchResult.stats.paid;
      agingRefreshed += batchResult.stats.aging;
      unchanged += batchResult.stats.unchanged;

      if (batchResult.done) {
        hasMore = false;
      } else {
        offset += batchSize;
      }
    }

    // 3. Sync to SQLite for legacy fallback
    try {
      db.prepare(`
        UPDATE emi_installments
        SET status = 'DUE_TODAY', updated_at = ?
        WHERE status = 'UPCOMING' AND due_date <= ?
      `).run(new Date().toISOString(), businessToday);

      db.prepare(`
        UPDATE emi_installments
        SET status = 'OVERDUE',
            days_overdue = MAX(1, CAST((julianday(?) - julianday(due_date)) AS INTEGER)),
            updated_at = ?
        WHERE status IN ('DUE_TODAY', 'PARTIALLY_PAID') AND due_date < ?
      `).run(businessToday, new Date().toISOString(), businessToday);
    } catch {
      // Safe fallback
    }

    console.log(
      `[EMIStateEngineJob] Completed: Evaluated ${totalEvaluated} EMIs. ${dueTodayUpdated} marked Due Today, ${overdueUpdated} marked Overdue, ${paidCorrected} corrected to Paid, ${agingRefreshed} aging refreshed, ${unchanged} unchanged.`
    );

    return {
      executedForDate: businessToday,
      totalEvaluated,
      dueTodayUpdated,
      overdueUpdated,
      paidCorrected,
      agingRefreshed,
      unchanged,
    };
  }
}
