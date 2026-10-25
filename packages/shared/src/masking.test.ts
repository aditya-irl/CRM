import { formatINR, formatCompactINR } from './masking';

describe('Financial Currency Formatting — Indian Numbering & Responsive Layout', () => {
  describe('formatINR (Exact Standard Indian Currency)', () => {
    test('formats numbers using standard Indian currency notation with decimals', () => {
      expect(formatINR(420000)).toMatch(/₹\s*4,20,000\.00/);
      expect(formatINR(544550.68)).toMatch(/₹\s*5,44,550\.68/);
      expect(formatINR(12500000)).toMatch(/₹\s*1,25,00,000\.00/);
      expect(formatINR(25000)).toMatch(/₹\s*25,000\.00/);
      expect(formatINR(0)).toMatch(/₹\s*0\.00/);
    });

    test('handles null, undefined, and NaN safely', () => {
      expect(formatINR(null)).toBe('₹0.00');
      expect(formatINR(undefined)).toBe('₹0.00');
      expect(formatINR('invalid')).toBe('₹0.00');
    });

    test('respects compact option when requested', () => {
      expect(formatINR(420000, { compact: true })).toBe('₹4.20L');
      expect(formatINR(544550.68, { compact: true })).toBe('₹5.45L');
    });
  });

  describe('formatCompactINR (Compact Financial Display Format)', () => {
    test('formats values in Lakhs (>= 1,00,000 and < 1,00,00,000) preserving 2-decimal precision', () => {
      expect(formatCompactINR(420000)).toBe('₹4.20L');
      expect(formatCompactINR(544550.68)).toBe('₹5.45L');
      expect(formatCompactINR(100000)).toBe('₹1.00L');
      expect(formatCompactINR(9999999.99)).toBe('₹100.00L');
    });

    test('formats values in Crores (>= 1,00,00,000)', () => {
      expect(formatCompactINR(10000000)).toBe('₹1.00Cr');
      expect(formatCompactINR(12500000)).toBe('₹1.25Cr');
      expect(formatCompactINR(45500000)).toBe('₹4.55Cr');
    });

    test('formats values under 1 Lakh with standard Indian currency to maintain exactness', () => {
      expect(formatCompactINR(25000)).toMatch(/₹\s*25,000\.00/);
      expect(formatCompactINR(500)).toMatch(/₹\s*500\.00/);
      expect(formatCompactINR(0)).toMatch(/₹\s*0\.00/);
    });

    test('formats negative values correctly preserving negative sign', () => {
      expect(formatCompactINR(-544550.68)).toBe('-₹5.45L');
      expect(formatCompactINR(-12500000)).toBe('-₹1.25Cr');
    });

    test('handles edge cases safely (null, undefined, invalid string)', () => {
      expect(formatCompactINR(null)).toBe('₹0.00');
      expect(formatCompactINR(undefined)).toBe('₹0.00');
      expect(formatCompactINR(NaN)).toBe('₹0.00');
      expect(formatCompactINR('abc')).toBe('₹0.00');
    });
  });
});
