import { generateAmortizationSchedule, allocatePaymentWaterfall, toFixed2 } from './financial';
import { InterestMethod, RepaymentFrequency, EMIStatus } from './enums';

describe('Financial Calculation Engine', () => {
  test('Flat Rate EMI calculation with Banker\'s rounding and last-cent adjustment', () => {
    // Principal: 100,000, Down Payment: 10,000 => Net: 90,000
    // Rate: 12% p.a., Tenure: 12 months
    // Total Interest = 90,000 * 0.12 * 1 = 10,800
    // Total Payable = 90,000 + 10,800 = 100,800
    // EMI = 100,800 / 12 = 8,400.00
    const result = generateAmortizationSchedule({
      principalAmount: 100000,
      downPayment: 10000,
      annualInterestRate: 12,
      tenureMonths: 12,
      installmentFrequency: RepaymentFrequency.MONTHLY,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      disbursementDate: '2026-01-01',
    });

    expect(result.netDisbursedAmount).toBe(90000);
    expect(result.totalInterest).toBe(10800);
    expect(result.totalPayable).toBe(100800);
    expect(result.totalInstallments).toBe(12);
    expect(result.schedule.length).toBe(12);

    // Sum of expected amounts must strictly match total payable
    const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
    expect(toFixed2(sumExpected)).toBe(100800);

    // Sum of principal components must strictly match net disbursed
    const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
    expect(toFixed2(sumPrincipal)).toBe(90000);

    // Sum of interest components must strictly match total interest
    const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
    expect(toFixed2(sumInterest)).toBe(10800);
  });

  test('Odd amounts and non-divisible installments ensure exact last-cent preservation', () => {
    // Principal: 33,333.33, Rate: 13.75% p.a., Tenure: 7 months
    const result = generateAmortizationSchedule({
      principalAmount: 33333.33,
      annualInterestRate: 13.75,
      tenureMonths: 7,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      disbursementDate: '2026-03-15',
    });

    const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
    expect(toFixed2(sumExpected)).toBe(result.totalPayable);

    const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
    expect(toFixed2(sumPrincipal)).toBe(result.netDisbursedAmount);
  });

  test('Reducing Balance Amortization accurately reduces principal over time', () => {
    // Principal: 50,000, Rate: 18% p.a., Tenure: 6 months
    const result = generateAmortizationSchedule({
      principalAmount: 50000,
      annualInterestRate: 18,
      tenureMonths: 6,
      interestCalcMethod: InterestMethod.REDUCING_BALANCE,
      disbursementDate: '2026-01-01',
    });

    expect(result.schedule.length).toBe(6);
    expect(result.totalPayable).toBeGreaterThan(50000);

    const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
    expect(toFixed2(sumPrincipal)).toBe(50000);
  });

  test('Waterfall payment allocation settles overdue EMIs chronologically', () => {
    const installments = [
      {
        id: 'emi-1',
        installmentNumber: 1,
        expectedAmount: 2000,
        paidAmount: 500,
        remainingAmount: 1500,
        penaltyAmount: 100, // Remaining due = 1600
        status: EMIStatus.PARTIALLY_PAID,
      },
      {
        id: 'emi-2',
        installmentNumber: 2,
        expectedAmount: 2000,
        paidAmount: 0,
        remainingAmount: 2000,
        penaltyAmount: 0, // Remaining due = 2000
        status: EMIStatus.OVERDUE,
      },
      {
        id: 'emi-3',
        installmentNumber: 3,
        expectedAmount: 2000,
        paidAmount: 0,
        remainingAmount: 2000,
        penaltyAmount: 0,
        status: EMIStatus.UPCOMING,
      },
    ];

    // Pay 2500:
    // First 1600 goes to emi-1 (becomes fully PAID)
    // Remaining 900 goes to emi-2 (becomes PARTIALLY_PAID with remaining 1100)
    const result = allocatePaymentWaterfall(2500, installments, 6000);

    expect(result.totalAllocated).toBe(2500);
    expect(result.unallocatedExcess).toBe(0);
    expect(result.newLoanOutstanding).toBe(3500);

    expect(result.allocatedPayments.length).toBe(2);
    expect(result.allocatedPayments[0].emiId).toBe('emi-1');
    expect(result.allocatedPayments[0].allocatedAmount).toBe(1600);
    expect(result.allocatedPayments[0].newStatus).toBe(EMIStatus.PAID);
    expect(result.allocatedPayments[0].newRemainingAmount).toBe(0);

    expect(result.allocatedPayments[1].emiId).toBe('emi-2');
    expect(result.allocatedPayments[1].allocatedAmount).toBe(900);
    expect(result.allocatedPayments[1].newStatus).toBe(EMIStatus.OVERDUE);
    expect(result.allocatedPayments[1].newRemainingAmount).toBe(1100);
  });
});
