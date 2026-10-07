import { generateAmortizationSchedule, allocatePaymentWaterfall, toFixed2, normalizeNumericLeadingZeros } from './financial';
import { formatDateDDMMYYYY, parseDisplayDateToISO } from './datetime';
import { InterestMethod, RepaymentFrequency, EMIStatus } from './enums';

describe('Financial Calculation Engine', () => {
  test('Monthly Flat Simple Interest — Mandatory Test Case (Retail 10k, DP 4k, Rate 1%, Tenure 6m)', () => {
    // Retail Price = ₹10,000, Down Payment = ₹4,000 => Principal = ₹6,000
    // Tenure = 6 months, Monthly Interest Rate = 1%
    // Monthly Interest: ₹6,000 × 1% = ₹60
    // Total Interest: ₹60 × 6 = ₹360
    // Total Payable: ₹6,000 + ₹360 = ₹6,360
    // Monthly EMI: ₹6,360 / 6 = ₹1,060
    const result = generateAmortizationSchedule({
      principalAmount: 10000,
      downPayment: 4000,
      monthlyInterestRate: 1,
      annualInterestRate: 1,
      tenureMonths: 6,
      installmentFrequency: RepaymentFrequency.MONTHLY,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      disbursementDate: '2026-10-06',
    });

    expect(result.netDisbursedAmount).toBe(6000);
    expect(result.totalInterest).toBe(360);
    expect(result.totalPayable).toBe(6360);
    expect(result.emiAmount).toBe(1060);
    expect(result.totalInstallments).toBe(6);
    expect(result.schedule.length).toBe(6);

    // Sum of expected amounts must strictly match total payable
    const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
    expect(toFixed2(sumExpected)).toBe(6360);

    // Sum of principal components must strictly match net disbursed
    const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
    expect(toFixed2(sumPrincipal)).toBe(6000);

    // Sum of interest components must strictly match total interest
    const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
    expect(toFixed2(sumInterest)).toBe(360);

    // Each installment is exactly 1060 (1000 principal + 60 interest)
    result.schedule.forEach((inst) => {
      expect(inst.expectedAmount).toBe(1060);
      expect(inst.principalComponent).toBe(1000);
      expect(inst.interestComponent).toBe(60);
    });
  });

  test('Monthly Flat Rate calculation with 1.5% monthly rate and zero down payment', () => {
    // Principal: 20,000, Down Payment: 0 => Net: 20,000
    // Monthly Rate: 1.5%, Tenure: 12 months
    // Monthly Interest: 20,000 * 1.5% = 300
    // Total Interest = 300 * 12 = 3,600
    // Total Payable = 20,000 + 3,600 = 23,600
    // Monthly EMI = 23,600 / 12 = 1,966.67
    const result = generateAmortizationSchedule({
      principalAmount: 20000,
      downPayment: 0,
      monthlyInterestRate: 1.5,
      tenureMonths: 12,
      installmentFrequency: RepaymentFrequency.MONTHLY,
      interestCalcMethod: InterestMethod.FLAT_RATE,
      disbursementDate: '2026-01-01',
    });

    expect(result.netDisbursedAmount).toBe(20000);
    expect(result.totalInterest).toBe(3600);
    expect(result.totalPayable).toBe(23600);
    expect(result.totalInstallments).toBe(12);
    expect(result.schedule.length).toBe(12);

    const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
    expect(toFixed2(sumExpected)).toBe(23600);
    const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
    expect(toFixed2(sumPrincipal)).toBe(20000);
  });

  test('Flat Rate EMI calculation with 1% monthly rate over 12 months', () => {
    // Principal: 100,000, Down Payment: 10,000 => Net: 90,000
    // Rate: 1% monthly, Tenure: 12 months
    // Monthly Interest = 90,000 * 1% = 900
    // Total Interest = 900 * 12 = 10,800
    // Total Payable = 90,000 + 10,800 = 100,800
    // EMI = 100,800 / 12 = 8,400.00
    const result = generateAmortizationSchedule({
      principalAmount: 100000,
      downPayment: 10000,
      monthlyInterestRate: 1,
      annualInterestRate: 1,
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
  describe('UAT Financial Engine Audits: Monthly Flat Simple Interest & Installment Counts', () => {
    test('CASE 1 — MONTHLY FLAT: Principal ₹100,000, 1% monthly, 12 Months -> exactly 12 installments, EMI = ₹9,333.33', () => {
      // Retail Price: 120,000, Down Payment: 20,000 => Net Disbursed (Financed Principal): 100,000
      // Rate: 1% monthly, Tenure: 12 months
      // Total Interest = 100,000 * 1% * 12 = 12,000
      // Total Payable = 100,000 + 12,000 = 112,000
      // Monthly EMI = 112,000 / 12 = 9,333.33
      const result = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        monthlyInterestRate: 1,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-09-01',
      });

      expect(result.netDisbursedAmount).toBe(100000);
      expect(result.totalInstallments).toBe(12);
      expect(result.schedule.length).toBe(12);
      expect(result.totalInterest).toBe(12000);
      expect(result.totalPayable).toBe(112000);
      expect(result.emiAmount).toBe(9333.33);

      // Verify each installment conservation
      const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
      expect(toFixed2(sumPrincipal)).toBe(100000);

      const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
      expect(toFixed2(sumInterest)).toBe(result.totalInterest);
    });

    test('CASE 2 — MONTHLY FLAT: Principal ₹100,000, 1.5% monthly, 6 Months -> exactly 6 installments, Total Interest = ₹9,000, EMI = ₹18,166.67', () => {
      // Retail Price: 120,000, Down Payment: 20,000 => Net Disbursed (Financed Principal): 100,000
      // Monthly Rate: 1.5%, Tenure: 6 months
      // Monthly Interest = 100,000 * 1.5% = 1,500
      // Total Interest = 1,500 * 6 = 9,000
      // Total Payable = 109,000
      // Monthly EMI = 109,000 / 6 = 18,166.67
      const result = generateAmortizationSchedule({
        principalAmount: 120000,
        downPayment: 20000,
        monthlyInterestRate: 1.5,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-09-01',
      });

      expect(result.netDisbursedAmount).toBe(100000);
      expect(result.totalInstallments).toBe(6);
      expect(result.schedule.length).toBe(6);

      expect(result.totalInterest).toBe(9000);
      expect(result.totalPayable).toBe(109000);
      expect(result.emiAmount).toBe(18166.67);

      const sumExpected = result.schedule.reduce((acc, curr) => acc + curr.expectedAmount, 0);
      expect(toFixed2(sumExpected)).toBe(109000);

      const sumPrincipal = result.schedule.reduce((acc, curr) => acc + curr.principalComponent, 0);
      expect(toFixed2(sumPrincipal)).toBe(100000);

      const sumInterest = result.schedule.reduce((acc, curr) => acc + curr.interestComponent, 0);
      expect(toFixed2(sumInterest)).toBe(9000);
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

  describe('Late-Payment Penalty Waterfall Allocation', () => {
    const overdueEmi = {
      id: 'emi-overdue-1',
      installmentNumber: 1,
      expectedAmount: 8791.59,
      paidAmount: 0,
      remainingAmount: 8791.59,
      penaltyAmount: 500,
      status: EMIStatus.OVERDUE,
      dueDate: '2026-09-10',
    };

    test('Customer pays full amount (₹9,291.59): Penalty is fully allocated, EMI is fully allocated and PAID', () => {
      const result = allocatePaymentWaterfall(9291.59, [overdueEmi], 9291.59, '2026-10-04');

      expect(result.totalAllocated).toBe(9291.59);
      expect(result.totalAllocatedToPenalty).toBe(500);
      expect(result.totalAllocatedToPrincipalInterest).toBe(8791.59);
      expect(result.unallocatedExcess).toBe(0);
      expect(result.newLoanOutstanding).toBe(0);

      const alloc = result.allocatedPayments[0];
      expect(alloc.allocatedToPenalty).toBe(500);
      expect(alloc.allocatedToPrincipalInterest).toBe(8791.59);
      expect(alloc.remainingPenalty).toBe(0);
      expect(alloc.newPaidAmount).toBe(8791.59);
      expect(alloc.newRemainingAmount).toBe(0);
      expect(alloc.newStatus).toBe(EMIStatus.PAID);
    });

    test('Customer pays only original EMI (₹8,791.59): Penalty paid first (₹500), ₹8,291.59 to EMI, EMI is NOT fully paid', () => {
      const result = allocatePaymentWaterfall(8791.59, [overdueEmi], 9291.59, '2026-10-04');

      expect(result.totalAllocated).toBe(8791.59);
      expect(result.totalAllocatedToPenalty).toBe(500);
      expect(result.totalAllocatedToPrincipalInterest).toBe(8291.59);

      const alloc = result.allocatedPayments[0];
      expect(alloc.allocatedToPenalty).toBe(500);
      expect(alloc.allocatedToPrincipalInterest).toBe(8291.59);
      expect(alloc.remainingPenalty).toBe(0);
      expect(alloc.newPaidAmount).toBe(8291.59);
      expect(alloc.newRemainingAmount).toBe(500);
      expect(alloc.newStatus).not.toBe(EMIStatus.PAID);
    });

    test('Customer pays partial penalty amount (₹300): ₹300 to penalty, ₹0 to EMI, remaining penalty ₹200', () => {
      const result = allocatePaymentWaterfall(300, [overdueEmi], 9291.59, '2026-10-04');

      expect(result.totalAllocated).toBe(300);
      expect(result.totalAllocatedToPenalty).toBe(300);
      expect(result.totalAllocatedToPrincipalInterest).toBe(0);

      const alloc = result.allocatedPayments[0];
      expect(alloc.allocatedToPenalty).toBe(300);
      expect(alloc.allocatedToPrincipalInterest).toBe(0);
      expect(alloc.remainingPenalty).toBe(200);
      expect(alloc.newPaidAmount).toBe(0);
      expect(alloc.newRemainingAmount).toBe(8791.59);
      expect(alloc.newStatus).not.toBe(EMIStatus.PAID);
    });
  });

  describe('Manual EMI Start Date and Tenure Selection', () => {
    test('Loan Date separate from manual EMI Start Date generates exact installments', () => {
      // Loan Origination Date: 2026-10-06
      // Manual EMI Start Date: 2026-11-05
      // Tenure: 12 months
      const result = generateAmortizationSchedule({
        principalAmount: 60000,
        downPayment: 10000,
        annualInterestRate: 14,
        tenureMonths: 12,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-05',
      });

      expect(result.disbursementDate).toBe('2026-10-06');
      expect(result.firstEmiDate).toBe('2026-11-05');
      expect(result.totalInstallments).toBe(12);
      expect(result.schedule.length).toBe(12);

      // Verify exact installment dates
      expect(result.schedule[0].dueDate).toBe('2026-11-05'); // Installment 1
      expect(result.schedule[1].dueDate).toBe('2026-12-05'); // Installment 2
      expect(result.schedule[2].dueDate).toBe('2027-01-05'); // Installment 3
      expect(result.schedule[10].dueDate).toBe('2027-09-05'); // Installment 11
      expect(result.schedule[11].dueDate).toBe('2027-10-05'); // Installment 12
      expect(result.maturityDate).toBe('2027-10-05');
    });

    test('Changing EMI Start Date preserves identical financial calculations and amounts', () => {
      const scheduleNov = generateAmortizationSchedule({
        principalAmount: 50000,
        downPayment: 5000,
        annualInterestRate: 15,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.REDUCING_BALANCE,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-05',
      });

      const scheduleDec = generateAmortizationSchedule({
        principalAmount: 50000,
        downPayment: 5000,
        annualInterestRate: 15,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.REDUCING_BALANCE,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-12-15',
      });

      // Amounts must be identical
      expect(scheduleNov.emiAmount).toBe(scheduleDec.emiAmount);
      expect(scheduleNov.totalInterest).toBe(scheduleDec.totalInterest);
      expect(scheduleNov.totalPayable).toBe(scheduleDec.totalPayable);
      expect(scheduleNov.netDisbursedAmount).toBe(scheduleDec.netDisbursedAmount);

      // Dates must strictly reflect the chosen start date
      expect(scheduleNov.schedule[0].dueDate).toBe('2026-11-05');
      expect(scheduleDec.schedule[0].dueDate).toBe('2026-12-15');
      expect(scheduleNov.maturityDate).toBe('2027-04-05');
      expect(scheduleDec.maturityDate).toBe('2027-05-15');
    });

    test('Safe month-end clamping when manual EMI Start Date is on 31st', () => {
      const result = generateAmortizationSchedule({
        principalAmount: 40000,
        annualInterestRate: 12,
        tenureMonths: 6,
        installmentFrequency: RepaymentFrequency.MONTHLY,
        interestCalcMethod: InterestMethod.FLAT_RATE,
        disbursementDate: '2026-01-15',
        firstEmiDate: '2026-01-31',
      });

      expect(result.schedule[0].dueDate).toBe('2026-01-31'); // Jan 31
      expect(result.schedule[1].dueDate).toBe('2026-02-28'); // Feb 28 (clamped)
      expect(result.schedule[2].dueDate).toBe('2026-03-31'); // Mar 31
      expect(result.schedule[3].dueDate).toBe('2026-04-30'); // Apr 30 (clamped)
      expect(result.schedule[4].dueDate).toBe('2026-05-31'); // May 31
      expect(result.schedule[5].dueDate).toBe('2026-06-30'); // Jun 30 (clamped)
      expect(result.maturityDate).toBe('2026-06-30');
    });

    test('Changing tenure generates exact installment count', () => {
      const res6 = generateAmortizationSchedule({
        principalAmount: 30000,
        annualInterestRate: 12,
        tenureMonths: 6,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-05',
      });

      const res12 = generateAmortizationSchedule({
        principalAmount: 30000,
        annualInterestRate: 12,
        tenureMonths: 12,
        disbursementDate: '2026-10-06',
        firstEmiDate: '2026-11-05',
      });

      expect(res6.totalInstallments).toBe(6);
      expect(res6.schedule.length).toBe(6);
      expect(res6.maturityDate).toBe('2027-04-05');

      expect(res12.totalInstallments).toBe(12);
      expect(res12.schedule.length).toBe(12);
      expect(res12.maturityDate).toBe('2027-10-05');
    });
  });

  describe('Numeric Input Leading Zero Normalization', () => {
    test('Normalizes integers with leading zeros correctly', () => {
      expect(normalizeNumericLeadingZeros('02345')).toBe('2345');
      expect(normalizeNumericLeadingZeros('000500')).toBe('500');
      expect(normalizeNumericLeadingZeros('000')).toBe('0');
      expect(normalizeNumericLeadingZeros('00125')).toBe('125');
      expect(normalizeNumericLeadingZeros('0')).toBe('0');
      expect(normalizeNumericLeadingZeros(500)).toBe('500');
      expect(normalizeNumericLeadingZeros(0)).toBe('0');
    });

    test('Normalizes decimals with leading zeros correctly without precision loss', () => {
      expect(normalizeNumericLeadingZeros('001.50')).toBe('1.50');
      expect(normalizeNumericLeadingZeros('000.50')).toBe('0.50');
      expect(normalizeNumericLeadingZeros('000.00')).toBe('0.00');
      expect(normalizeNumericLeadingZeros('0.75')).toBe('0.75');
      expect(normalizeNumericLeadingZeros('00125.99')).toBe('125.99');
    });

    test('Handles negative values, empty input, and non-numeric safely', () => {
      expect(normalizeNumericLeadingZeros('-0050')).toBe('-50');
      expect(normalizeNumericLeadingZeros('-000.25')).toBe('-0.25');
      expect(normalizeNumericLeadingZeros('')).toBe('');
      expect(normalizeNumericLeadingZeros(null)).toBe('');
      expect(normalizeNumericLeadingZeros(undefined)).toBe('');
      expect(normalizeNumericLeadingZeros('invalid')).toBe('invalid');
    });
  });

  describe('Global Date Formatting & Parsing (DD/MM/YYYY)', () => {
    test('Renders date-only ISO strings as DD/MM/YYYY without timezone shift', () => {
      expect(formatDateDDMMYYYY('2026-10-07')).toBe('07/10/2026');
      expect(formatDateDDMMYYYY('2026-01-05')).toBe('05/01/2026');
      expect(formatDateDDMMYYYY('2026-12-31')).toBe('31/12/2026');
      expect(formatDateDDMMYYYY('2026-02-28')).toBe('28/02/2026');
    });

    test('Parses DD/MM/YYYY back into ISO YYYY-MM-DD cleanly', () => {
      expect(parseDisplayDateToISO('07/10/2026')).toBe('2026-10-07');
      expect(parseDisplayDateToISO('05/01/2026')).toBe('2026-01-05');
      expect(parseDisplayDateToISO('31/12/2026')).toBe('2026-12-31');
    });

    test('Handles null, undefined, empty safely', () => {
      expect(formatDateDDMMYYYY(null)).toBe('-');
      expect(formatDateDDMMYYYY(undefined)).toBe('-');
      expect(formatDateDDMMYYYY('')).toBe('-');
      expect(parseDisplayDateToISO('')).toBe('');
    });
  });
});

