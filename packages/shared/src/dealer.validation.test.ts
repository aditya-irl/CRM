/**
 * Regression tests for createDealerSchema
 *
 * Bug: "The string did not match the expected pattern."
 * Root cause:
 *   1. Frontend: <input type="email"> triggers browser-native HTML5 constraint validation,
 *      blocking form submission with that error message in Safari/WebKit before the
 *      React onSubmit handler could call e.preventDefault().
 *   2. Backend: Zod schema rejected empty-string ("") values for optional email/alternatePhone
 *      fields because z.string().email() validates even empty strings — only null/undefined
 *      were handled by .optional().nullable().
 *
 * Fix:
 *   - Frontend: changed type="email" → type="text" + inputMode="email" to prevent
 *     browser-native constraint validation while preserving mobile keyboard hints.
 *   - Backend: added z.preprocess() to coerce "" → null before Zod validation.
 */

import { createDealerSchema, updateDealerSchema } from './validation';

const validBase = {
  storeName: 'Rathore Mobile',
  ownerName: 'Rakesh Kumar',
  phone: '9876543210',
  address: '123 Main Market, Dadri',
  areaCity: 'Dadri',
};

describe('createDealerSchema — regression: empty / omitted optional fields', () => {
  test('passes when email and alternatePhone are omitted', () => {
    expect(() => createDealerSchema.parse(validBase)).not.toThrow();
  });

  test('passes when email is null', () => {
    expect(() =>
      createDealerSchema.parse({ ...validBase, email: null })
    ).not.toThrow();
  });

  test('passes when alternatePhone is null', () => {
    expect(() =>
      createDealerSchema.parse({ ...validBase, alternatePhone: null })
    ).not.toThrow();
  });

  // Regression: these two cases previously caused "Invalid email address" /
  // "Invalid alternate phone number" Zod errors when the browser sent an empty
  // string instead of null.
  test('REGRESSION — passes when email is empty string "" (coerced to null)', () => {
    const result = createDealerSchema.parse({ ...validBase, email: '' });
    expect(result.email).toBeNull();
  });

  test('REGRESSION — passes when alternatePhone is empty string "" (coerced to null)', () => {
    const result = createDealerSchema.parse({ ...validBase, alternatePhone: '' });
    expect(result.alternatePhone).toBeNull();
  });

  test('passes when a valid email is provided', () => {
    const result = createDealerSchema.parse({
      ...validBase,
      email: 'dealer@example.com',
    });
    expect(result.email).toBe('dealer@example.com');
  });

  test('fails when an invalid email string (non-empty) is provided', () => {
    expect(() =>
      createDealerSchema.parse({ ...validBase, email: 'not-an-email' })
    ).toThrow();
  });

  test('passes when alternatePhone is a valid 10-digit number', () => {
    const result = createDealerSchema.parse({
      ...validBase,
      alternatePhone: '8765432109',
    });
    expect(result.alternatePhone).toBe('8765432109');
  });

  test('fails when alternatePhone is an invalid format (too short)', () => {
    expect(() =>
      createDealerSchema.parse({ ...validBase, alternatePhone: '123' })
    ).toThrow();
  });

  test('passes with a phone number containing spaces', () => {
    expect(() =>
      createDealerSchema.parse({ ...validBase, phone: '98765 43210' })
    ).not.toThrow();
  });

  test('fails when required storeName is missing', () => {
    const { storeName: _omit, ...rest } = validBase as any;
    expect(() => createDealerSchema.parse(rest)).toThrow();
  });
});

describe('updateDealerSchema — partial updates', () => {
  test('passes with no fields (empty patch)', () => {
    expect(() => updateDealerSchema.parse({})).not.toThrow();
  });

  test('REGRESSION — passes when email is "" in a partial update', () => {
    const result = updateDealerSchema.parse({ email: '' });
    expect(result.email).toBeNull();
  });

  test('REGRESSION — passes when alternatePhone is "" in a partial update', () => {
    const result = updateDealerSchema.parse({ alternatePhone: '' });
    expect(result.alternatePhone).toBeNull();
  });
});
