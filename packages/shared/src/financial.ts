import { Decimal } from 'decimal.js';
import { InterestMethod, RepaymentFrequency, EMIStatus } from './enums';
import { calculateNextDueDate } from './datetime';

// Configure Decimal.js for financial precision: 20 significant digits, ROUND_HALF_EVEN (Banker's rounding)
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_EVEN });

export interface LoanCalculationInput {
  principalAmount: number | string;
  downPayment?: number | string;
  annualInterestRate?: number | string; // Maintained for schema compatibility
  monthlyInterestRate?: number | string; // Monthly Flat Simple Interest rate (e.g. 1 for 1%, 1.5 for 1.5%)
  interestRate?: number | string;
  tenureMonths: number;
  installmentFrequency?: RepaymentFrequency;
  interestCalcMethod?: InterestMethod;
  disbursementDate: string | Date;
  firstEmiDate?: string | Date;
  emiStartDate?: string | Date;
}

export interface CalculatedInstallment {
  installmentNumber: number;
  dueDate: string;
  principalComponent: number;
  interestComponent: number;
  expectedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  penaltyAmount: number;
  status: EMIStatus;
  daysOverdue: number;
}

export interface LoanCalculationResult {
  principalAmount: number;
  downPayment: number;
  netDisbursedAmount: number;
  annualInterestRate: number; // Kept for schema compatibility
  monthlyInterestRate: number; // Authoritative monthly rate
  interestCalcMethod: InterestMethod;
  tenureMonths: number;
  installmentFrequency: RepaymentFrequency;
  totalInstallments: number;
  emiAmount: number;
  totalInterest: number;
  totalPayable: number;
  outstandingBalance: number;
  disbursementDate: string;
  firstEmiDate: string;
  maturityDate: string;
  schedule: CalculatedInstallment[];
}

/**
 * Format a Decimal instance to exactly 2 decimal places as a standard JavaScript number.
 */
export function toFixed2(val: Decimal.Value): number {
  return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN).toNumber();
}

/**
 * Helper to add intervals based on repayment frequency.
 * Reuses calculateNextDueDate for calendar-month arithmetic and safe month-end clamping.
 */
export function getNextDueDate(startDate: Date | string, installmentIndex: number, frequency: RepaymentFrequency): string {
  const dateStr = typeof startDate === 'string'
    ? startDate.split('T')[0]
    : startDate.toISOString().split('T')[0];
  return calculateNextDueDate(dateStr, installmentIndex, frequency);
}

/**
 * Deterministic Financial Amortization Engine
 * Handles Monthly Flat Simple Interest with Banker's Rounding
 * and Last-Cent Discrepancy Adjustment.
 *
 * Authoritative Formula:
 * Financed Principal = Retail Price - Down Payment
 * Monthly Interest = Financed Principal × Monthly Interest Rate / 100
 * Total Interest = Monthly Interest × Tenure
 * Total Payable = Financed Principal + Total Interest
 * Monthly EMI = Total Payable / Tenure
 */
export function generateAmortizationSchedule(input: LoanCalculationInput): LoanCalculationResult {
  const principalRaw = new Decimal(input.principalAmount);
  const downPayment = input.downPayment ? new Decimal(input.downPayment) : new Decimal(0);
  const netDisbursed = principalRaw.minus(downPayment);

  if (netDisbursed.lessThanOrEqualTo(0)) {
    throw new Error('Principal amount minus down payment must be greater than zero.');
  }

  const tenureMonths = Number(input.tenureMonths);
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new Error('Tenure in months must be a positive integer.');
  }

  // Monthly Interest Rate: accept monthlyInterestRate, interestRate, or annualInterestRate
  const rawRateInput = input.monthlyInterestRate ?? input.interestRate ?? input.annualInterestRate ?? 1;
  const rawRate = new Decimal(rawRateInput);

  // Normalize rate: if passed as fraction (e.g. 0.01 for 1% or 0.015 for 1.5%), convert to percent
  let monthlyRatePercent = rawRate;
  if (monthlyRatePercent.greaterThan(0) && monthlyRatePercent.lessThan(0.05)) {
    monthlyRatePercent = monthlyRatePercent.times(100);
  }

  const frequency = input.installmentFrequency || RepaymentFrequency.MONTHLY;
  const method = input.interestCalcMethod || InterestMethod.FLAT_RATE;

  // Calculate total installments based on frequency
  let totalInstallments = tenureMonths;
  if (frequency === RepaymentFrequency.BI_WEEKLY) {
    totalInstallments = Math.round(tenureMonths * 2.17);
  } else if (frequency === RepaymentFrequency.WEEKLY) {
    totalInstallments = Math.round(tenureMonths * 4.33);
  } else if (frequency === RepaymentFrequency.DAILY) {
    totalInstallments = tenureMonths * 30;
  } else {
    totalInstallments = tenureMonths;
  }

  const disbDateStr = typeof input.disbursementDate === 'string'
    ? input.disbursementDate.split('T')[0]
    : input.disbursementDate.toISOString().split('T')[0];

  const rawFirstEmiDate = input.firstEmiDate || input.emiStartDate;
  let firstEmiDateStr: string;
  if (rawFirstEmiDate) {
    firstEmiDateStr = typeof rawFirstEmiDate === 'string'
      ? rawFirstEmiDate.split('T')[0]
      : rawFirstEmiDate.toISOString().split('T')[0];
  } else {
    firstEmiDateStr = calculateNextDueDate(disbDateStr, 1, frequency);
  }

  let totalInterest: Decimal;
  let totalPayable: Decimal;
  let baseEmi: Decimal;
  const schedule: CalculatedInstallment[] = [];

  // Monthly Flat Simple Interest Calculation:
  // Monthly Interest = Financed Principal × Monthly Interest Rate / 100
  const monthlyRateFraction = monthlyRatePercent.dividedBy(100);
  const monthlyInterest = netDisbursed.times(monthlyRateFraction).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

  // Total Interest = Monthly Interest × Tenure
  totalInterest = monthlyInterest.times(tenureMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

  // Total Payable = Financed Principal + Total Interest
  totalPayable = netDisbursed.plus(totalInterest);

  // Monthly EMI = Total Payable / Tenure
  baseEmi = totalPayable.dividedBy(totalInstallments).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const basePrincipalComponent = netDisbursed.dividedBy(totalInstallments).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const baseInterestComponent = totalInterest.dividedBy(totalInstallments).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

  let accruedPrincipal = new Decimal(0);
  let accruedInterest = new Decimal(0);
  let accruedTotal = new Decimal(0);

  for (let i = 1; i <= totalInstallments; i++) {
    const isLast = i === totalInstallments;
    const dueDate = getNextDueDate(firstEmiDateStr, i - 1, frequency);

    let pComp: Decimal;
    let iComp: Decimal;
    let emiAmount: Decimal;

    if (!isLast) {
      pComp = basePrincipalComponent;
      iComp = baseInterestComponent;
      emiAmount = pComp.plus(iComp);

      accruedPrincipal = accruedPrincipal.plus(pComp);
      accruedInterest = accruedInterest.plus(iComp);
      accruedTotal = accruedTotal.plus(emiAmount);
    } else {
      // Last installment delta adjustment to guarantee exact conservation
      pComp = netDisbursed.minus(accruedPrincipal);
      iComp = totalInterest.minus(accruedInterest);
      emiAmount = totalPayable.minus(accruedTotal);
    }

    schedule.push({
      installmentNumber: i,
      dueDate,
      principalComponent: toFixed2(pComp),
      interestComponent: toFixed2(iComp),
      expectedAmount: toFixed2(emiAmount),
      paidAmount: 0.0,
      remainingAmount: toFixed2(emiAmount),
      penaltyAmount: 0.0,
      status: EMIStatus.UPCOMING,
      daysOverdue: 0,
    });
  }

  const maturityDate = schedule[schedule.length - 1]?.dueDate || firstEmiDateStr;

  return {
    principalAmount: toFixed2(principalRaw),
    downPayment: toFixed2(downPayment),
    netDisbursedAmount: toFixed2(netDisbursed),
    annualInterestRate: monthlyRatePercent.toNumber(),
    monthlyInterestRate: monthlyRatePercent.toNumber(),
    interestCalcMethod: method,
    tenureMonths,
    installmentFrequency: frequency,
    totalInstallments,
    emiAmount: toFixed2(baseEmi),
    totalInterest: toFixed2(totalInterest),
    totalPayable: toFixed2(totalPayable),
    outstandingBalance: toFixed2(totalPayable),
    disbursementDate: disbDateStr,
    firstEmiDate: firstEmiDateStr,
    maturityDate,
    schedule,
  };
}

export interface WaterfallAllocationResult {
  allocatedPayments: Array<{
    emiId: string;
    installmentNumber: number;
    allocatedAmount: number;
    allocatedToPenalty: number;
    allocatedToPrincipalInterest: number;
    remainingPenalty: number;
    newPaidAmount: number;
    newRemainingAmount: number;
    newStatus: EMIStatus;
  }>;
  totalAllocated: number;
  totalAllocatedToPenalty: number;
  totalAllocatedToPrincipalInterest: number;
  unallocatedExcess: number;
  newLoanOutstanding: number;
}

/**
 * Execute atomic waterfall payment distribution across overdue and current installments.
 */
export function allocatePaymentWaterfall(
  paymentAmount: number | string,
  unpaidInstallments: Array<{
    id: string;
    installmentNumber: number;
    expectedAmount: number;
    paidAmount: number;
    remainingAmount: number;
    penaltyAmount: number;
    status: EMIStatus;
    dueDate?: string;
  }>,
  currentLoanOutstanding: number | string,
  businessToday?: string
): WaterfallAllocationResult {
  let unallocated = new Decimal(paymentAmount);
  if (unallocated.lessThanOrEqualTo(0)) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const allocatedPayments: WaterfallAllocationResult['allocatedPayments'] = [];
  let totalAllocated = new Decimal(0);
  let totalAllocatedToPenalty = new Decimal(0);
  let totalAllocatedToPrincipalInterest = new Decimal(0);

  // Sort installments chronologically by installment number
  const sorted = [...unpaidInstallments].sort((a, b) => a.installmentNumber - b.installmentNumber);

  for (const emi of sorted) {
    if (unallocated.isZero()) break;

    const remainingDue = new Decimal(emi.remainingAmount).plus(emi.penaltyAmount);
    if (remainingDue.lessThanOrEqualTo(0)) continue;

    let allocateToEmi: Decimal;
    if (unallocated.greaterThanOrEqualTo(remainingDue)) {
      allocateToEmi = remainingDue;
      unallocated = unallocated.minus(remainingDue);
    } else {
      allocateToEmi = unallocated;
      unallocated = new Decimal(0);
    }

    // Breakdown allocation: Late-payment penalty first, then principal/interest
    const penaltyTotal = new Decimal(emi.penaltyAmount || 0);
    const allocPenalty = Decimal.min(allocateToEmi, penaltyTotal);
    const allocPI = allocateToEmi.minus(allocPenalty);
    const remainingPenalty = penaltyTotal.minus(allocPenalty);

    // emi.paidAmount and emi.remainingAmount track the principal/interest component
    const currentPaid = new Decimal(emi.paidAmount || 0);
    const currentRemaining = new Decimal(emi.remainingAmount || 0);
    const newPaidAmount = currentPaid.plus(allocPI);
    const newRemainingAmount = Decimal.max(0, currentRemaining.minus(allocPI));

    let newStatus: EMIStatus;
    if (newRemainingAmount.lessThanOrEqualTo(0) && remainingPenalty.lessThanOrEqualTo(0)) {
      newStatus = EMIStatus.PAID;
    } else if (emi.dueDate && businessToday) {
      newStatus = computeEmiStatus({
        dueDate: emi.dueDate,
        expectedAmount: emi.expectedAmount,
        paidAmount: newPaidAmount.toNumber(),
        penaltyAmount: remainingPenalty.toNumber(),
        businessToday,
      }).status;
    } else {
      newStatus = emi.status === EMIStatus.OVERDUE ? EMIStatus.OVERDUE : EMIStatus.PARTIALLY_PAID;
    }

    allocatedPayments.push({
      emiId: emi.id,
      installmentNumber: emi.installmentNumber,
      allocatedAmount: toFixed2(allocateToEmi),
      allocatedToPenalty: toFixed2(allocPenalty),
      allocatedToPrincipalInterest: toFixed2(allocPI),
      remainingPenalty: toFixed2(remainingPenalty),
      newPaidAmount: toFixed2(newPaidAmount),
      newRemainingAmount: toFixed2(newRemainingAmount),
      newStatus,
    });

    totalAllocated = totalAllocated.plus(allocateToEmi);
    totalAllocatedToPenalty = totalAllocatedToPenalty.plus(allocPenalty);
    totalAllocatedToPrincipalInterest = totalAllocatedToPrincipalInterest.plus(allocPI);
  }

  const loanOutstanding = new Decimal(currentLoanOutstanding);
  const newLoanOutstanding = loanOutstanding.minus(totalAllocated).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

  return {
    allocatedPayments,
    totalAllocated: toFixed2(totalAllocated),
    totalAllocatedToPenalty: toFixed2(totalAllocatedToPenalty),
    totalAllocatedToPrincipalInterest: toFixed2(totalAllocatedToPrincipalInterest),
    unallocatedExcess: toFixed2(unallocated),
    newLoanOutstanding: Math.max(0, newLoanOutstanding.toNumber()),
  };
}

export interface ReversalAllocationResult {
  restoredInstallments: Array<{
    emiId: string;
    installmentNumber: number;
    restoredPaidAmount: number;
    restoredRemainingAmount: number;
    newStatus: EMIStatus;
    deductedAmount: number;
  }>;
  totalRestored: number;
  newLoanOutstanding: number;
}

/**
 * Execute atomic reversal unwinding across installments in reverse chronological order.
 */
export function reversePaymentAllocation(
  reversalAmount: number | string,
  installments: Array<{
    id: string;
    installmentNumber: number;
    expectedAmount: number;
    paidAmount: number;
    remainingAmount: number;
    penaltyAmount: number;
    status: EMIStatus;
    dueDate?: string;
  }>,
  currentLoanOutstanding: number | string,
  businessToday?: string
): ReversalAllocationResult {
  let unreversed = new Decimal(reversalAmount);
  if (unreversed.lessThanOrEqualTo(0)) {
    throw new Error('Reversal amount must be greater than zero.');
  }

  const restoredInstallments: ReversalAllocationResult['restoredInstallments'] = [];
  let totalRestored = new Decimal(0);

  // Sort installments descending (unwind most recent payments first)
  const sorted = [...installments].sort((a, b) => b.installmentNumber - a.installmentNumber);

  for (const emi of sorted) {
    if (unreversed.isZero()) break;

    const currentPaid = new Decimal(emi.paidAmount);
    if (currentPaid.lessThanOrEqualTo(0)) continue;

    let deductFromEmi: Decimal;
    if (unreversed.greaterThanOrEqualTo(currentPaid)) {
      deductFromEmi = currentPaid;
      unreversed = unreversed.minus(currentPaid);
    } else {
      deductFromEmi = unreversed;
      unreversed = new Decimal(0);
    }

    const newPaidAmount = currentPaid.minus(deductFromEmi);
    const totalDue = new Decimal(emi.expectedAmount).plus(emi.penaltyAmount || 0);
    const newRemainingAmount = totalDue.minus(newPaidAmount);

    let newStatus: EMIStatus;
    if (newRemainingAmount.lessThanOrEqualTo(0)) {
      newStatus = EMIStatus.PAID;
    } else if (emi.dueDate && businessToday) {
      newStatus = computeEmiStatus({
        dueDate: emi.dueDate,
        expectedAmount: emi.expectedAmount,
        paidAmount: newPaidAmount.toNumber(),
        penaltyAmount: emi.penaltyAmount,
        businessToday,
      }).status;
    } else {
      newStatus = newPaidAmount.isZero() ? EMIStatus.UPCOMING : EMIStatus.PARTIALLY_PAID;
    }

    restoredInstallments.push({
      emiId: emi.id,
      installmentNumber: emi.installmentNumber,
      restoredPaidAmount: toFixed2(newPaidAmount),
      restoredRemainingAmount: toFixed2(newRemainingAmount),
      newStatus,
      deductedAmount: toFixed2(deductFromEmi),
    });

    totalRestored = totalRestored.plus(deductFromEmi);
  }

  const loanOutstanding = new Decimal(currentLoanOutstanding);
  const newLoanOutstanding = loanOutstanding.plus(totalRestored).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);

  return {
    restoredInstallments,
    totalRestored: toFixed2(totalRestored),
    newLoanOutstanding: newLoanOutstanding.toNumber(),
  };
}

/**
 * Get current business date in YYYY-MM-DD format according to business timezone (default: Asia/Kolkata).
 */
export function getBusinessDate(dateInput?: Date | string, timeZone = 'Asia/Kolkata'): string {
  const d = dateInput ? (typeof dateInput === 'string' ? new Date(dateInput) : dateInput) : new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
}

/**
 * Add or subtract days from a YYYY-MM-DD date string deterministically.
 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Compute integer difference in days between two YYYY-MM-DD date strings (toDate - fromDate).
 */
export function getDaysDifference(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((t2 - t1) / msPerDay);
}

export interface EmiEvaluationInput {
  dueDate: string;
  expectedAmount: number | string;
  paidAmount: number | string;
  remainingAmount?: number | string;
  penaltyAmount?: number | string;
  businessToday: string;
}

export interface EmiEvaluationResult {
  status: EMIStatus;
  daysOverdue: number;
  remainingAmount: number;
  isPaid: boolean;
  isOverdue: boolean;
  isDueToday: boolean;
}

/**
 * Pure, deterministic EMI status and aging evaluator.
 */
export function computeEmiStatus(input: EmiEvaluationInput): EmiEvaluationResult {
  const expected = new Decimal(input.expectedAmount);
  const paid = new Decimal(input.paidAmount);
  const penalty = input.penaltyAmount ? new Decimal(input.penaltyAmount) : new Decimal(0);
  const totalExpected = expected.plus(penalty);
  const remaining = totalExpected.minus(paid).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
  const remainingNum = Math.max(0, remaining.toNumber());

  // 1. Fully Paid Rule: If remaining <= 0 or paid >= totalExpected, status is always PAID with 0 days overdue
  if (remaining.lessThanOrEqualTo(0) || paid.greaterThanOrEqualTo(totalExpected)) {
    return {
      status: EMIStatus.PAID,
      daysOverdue: 0,
      remainingAmount: 0,
      isPaid: true,
      isOverdue: false,
      isDueToday: false,
    };
  }

  const daysDiff = getDaysDifference(input.dueDate, input.businessToday);

  // 2. Future / Upcoming Rule (dueDate > businessToday)
  if (daysDiff < 0) {
    const status = paid.greaterThan(0) ? EMIStatus.PARTIALLY_PAID : EMIStatus.UPCOMING;
    return {
      status,
      daysOverdue: 0,
      remainingAmount: remainingNum,
      isPaid: false,
      isOverdue: false,
      isDueToday: false,
    };
  }

  // 3. Due Today Rule (dueDate == businessToday)
  if (daysDiff === 0) {
    return {
      status: EMIStatus.DUE_TODAY,
      daysOverdue: 0,
      remainingAmount: remainingNum,
      isPaid: false,
      isOverdue: false,
      isDueToday: true,
    };
  }

  // 4. Overdue Rule (dueDate < businessToday)
  return {
    status: EMIStatus.OVERDUE,
    daysOverdue: daysDiff,
    remainingAmount: remainingNum,
    isPaid: false,
    isOverdue: true,
    isDueToday: false,
  };
}

