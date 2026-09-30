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

  // ===========================================================================
  // UAT REGRESSION TESTS: CASE 1 (REDUCING BALANCE) & CASE 2 (FLAT RATE)
  // ===========================================================================
  describe('UAT Financial Engine Audits: Reducing Balance vs Flat Rate & Installment Counts', () => {
    test('CASE 1 — REDUCING BALANCE: Principal ₹100,000, 10% p.a., 12 Months -> exactly 12 installments, EMI ≈ ₹8,791.59', () => {
      // Retail Price: 120,000, Down Payment: 20,000 => Net Disbursed (Financed Principal): 100,000
      const result = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        annualInterestRate: 10,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.REDUCING_BALANCE,
        disbursementDate: '2026-09-01',
      });

      expect(result.netDisbursedAmount).toBe(100000);
      expect(result.totalInstallments).toBe(12);
      expect(result.schedule.length).toBe(12);
      expect(result.emiAmount).toBe(8791.59);
      expect(Math.abs(result.totalInterest - 5499.06)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(result.totalPayable - 105499.06)).toBeLessThanOrEqual(0.02);

      // Verify that EMI is NOT ₹7,033.27 (which occurred when down payment was subtracted twice: 100,000 - 20,000 = 80,000)
      expect(result.emiAmount).not.toBe(7033.27);

      // Verify each installment conservation
      const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
      expect(toFixed2(sumPrincipal)).toBe(100000);

      const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
      expect(toFixed2(sumInterest)).toBe(result.totalInterest);
    });

    test('CASE 2 — FLAT RATE: Principal ₹100,000, 10% p.a., 12 Months -> exactly 12 installments, Total Interest = ₹10,000, EMI ≈ ₹9,166.67', () => {
      // Retail Price: 120,000, Down Payment: 20,000 => Net Disbursed (Financed Principal): 100,000
      const result = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        annualInterestRate: 10,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-09-01',
      });

      expect(result.netDisbursedAmount).toBe(100000);
      expect(result.totalInstallments).toBe(12);
      expect(result.schedule.length).toBe(12);

      // Total interest = 100,000 * 10% * 1 year = 10,000
      expect(result.totalInterest).toBe(10000);
      // Total payable = 100,000 + 10,000 = 110,000
      expect(result.totalPayable).toBe(110000);
      // Monthly installment = 110,000 / 12 = 9,166.67
      expect(result.emiAmount).toBe(9166.67);

      // Sum of expected amounts must strictly match 110,000
      const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
      expect(toFixed2(sumExpected)).toBe(110000);

      // Sum of principal components must strictly match 100,000
      const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
      expect(toFixed2(sumPrincipal)).toBe(100000);

      // Sum of interest components must strictly match 10,000
      const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
      expect(toFixed2(sumInterest)).toBe(10000);
    });

    test('6-month monthly loan produces exactly 6 installments and 12-month produces exactly 12 installments', () => {
      const loan6 = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        annualInterestRate: 10,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-09-01',
      });

      expect(loan6.totalInstallments).toBe(6);
      expect(loan6.schedule.length).toBe(6);

      const loan12 = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        annualInterestRate: 10,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-09-01',
      });

      expect(loan12.totalInstallments).toBe(12);
      expect(loan12.schedule.length).toBe(12);
      // A 12-month loan must NEVER produce 6 installments
      expect(loan12.totalInstallments).not.toBe(6);
      expect(loan12.schedule.length).not.toBe(6);
    });
  });
});
