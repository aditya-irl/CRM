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
 * Format a date string or object to DD/MM/YYYY presentation format.
 * Prevents timezone shifting bugs for date-only strings (e.g. 2026-10-07 -> 07/10/2026).
 */
export function formatDateDDMMYYYY(date: string | Date | null | undefined): string {
  if (!date) return '-';

  if (typeof date === 'string') {
    const trimmed = date.trim();
    if (!trimmed) return '-';

    // Date-only string or ISO with midnight UTC: directly split without timezone drift
    const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch && (!trimmed.includes('T') || trimmed.endsWith('T00:00:00.000Z') || trimmed.endsWith('T00:00:00Z'))) {
      const [, y, m, d] = dateMatch;
      return `${d}/${m}/${y}`;
    }

    // Timestamp with time component
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) return trimmed;
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: BUSINESS_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsed);
  }

  if (isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/**
 * Format a date string or object to Indian Standard Display format (DD/MM/YYYY).
 * Alias for formatDateDDMMYYYY.
 */
export function formatDisplayDate(date: string | Date | null | undefined): string {
  return formatDateDDMMYYYY(date);
}

/**
 * Parse a DD/MM/YYYY presentation date back into ISO YYYY-MM-DD.
 * e.g. "07/10/2026" -> "2026-10-07"
 */
export function parseDisplayDateToISO(displayDate: string | null | undefined): string {
  if (!displayDate) return '';
  const trimmed = displayDate.trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return trimmed;
  const [, d, m, y] = match;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
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
