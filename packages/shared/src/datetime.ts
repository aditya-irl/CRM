import { RepaymentFrequency } from './enums';

export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

/**
 * Get current business date in 'YYYY-MM-DD' format strictly evaluated in Asia/Kolkata timezone.
 */
export function getBusinessDateStr(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Get current business timestamp in ISO string format.
 */
export function getBusinessTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Format a date string or object to Indian Standard Display format (DD/MM/YYYY).
 */
export function formatDisplayDate(date: string | Date): string {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Compute days overdue between due date and as-of date deterministically.
 * Returns integer >= 0.
 */
export function calculateDaysOverdue(dueDateStr: string, asOfDateStr?: string): number {
  const asOf = asOfDateStr ? new Date(`${asOfDateStr}T00:00:00Z`) : new Date(`${getBusinessDateStr()}T00:00:00Z`);
  const due = new Date(`${dueDateStr}T00:00:00Z`);

  const diffTime = asOf.getTime() - due.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Calculate due date for installment based on repayment frequency.
 *
 * NOTE ON MONTH-END BEHAVIOR [BUSINESS DECISION REQUIRED]:
 * When a loan starts on the 31st (e.g. Jan 31), subsequent monthly installments in
 * February fall on Feb 28 (or Feb 29 in leap year). By default, this function clamps
 * to the last day of the target month.
 */
export function calculateNextDueDate(
  firstEmiDateStr: string,
  installmentIndex: number,
  frequency: RepaymentFrequency
): string {
  const [year, month, day] = firstEmiDateStr.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));

  if (frequency === RepaymentFrequency.MONTHLY) {
    const targetMonth = month - 1 + installmentIndex;
    target.setUTCMonth(targetMonth);
    // If target month overflowed due to 31st on a 30-day month, clamp to last day of previous month
    if (target.getUTCMonth() !== (targetMonth % 12 + 12) % 12) {
      target.setUTCDate(0); // Clamps to last day of target month
    }
  } else if (frequency === RepaymentFrequency.BI_WEEKLY) {
    target.setUTCDate(target.getUTCDate() + installmentIndex * 14);
  } else if (frequency === RepaymentFrequency.WEEKLY) {
    target.setUTCDate(target.getUTCDate() + installmentIndex * 7);
  } else if (frequency === RepaymentFrequency.DAILY) {
    target.setUTCDate(target.getUTCDate() + installmentIndex * 1);
  }

  return target.toISOString().split('T')[0];
}
