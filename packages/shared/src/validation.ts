import { z } from 'zod';
import {
  UserRole,
  KYCType,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CallOutcome,
  LoanStatus,
  DealerStatus,
  CollectionSource,
  PaymentStatus,
  SettlementStatus,
  SettlementPaymentMethod,
  UserStatus,
} from './enums';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email, Phone, or Login ID is required').optional(),
  identifier: z.string().min(1, 'Email, Phone, or Login ID is required').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
}).refine(data => Boolean(data.email || data.identifier), {
  message: 'Email, Phone, or Login ID is required',
  path: ['email'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

export const updateDealerLoginStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
});

export const createDealerSchema = z.object({
  storeName: z.string().min(2, 'Store name must be at least 2 characters'),
  ownerName: z.string().min(2, 'Owner name must be at least 2 characters'),
  phone: z.string().regex(/^[0-9+()\-\s]{10,15}$/, 'Invalid mobile phone number'),
  alternatePhone: z
    .preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.string().regex(/^[0-9+()\-\s]{10,15}$/, 'Invalid alternate phone number').nullable()
    )
    .optional(),
  email: z
    .preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.string().email('Invalid email address').nullable()
    )
    .optional(),
  address: z.string().min(5, 'Full store address is required'),
  areaCity: z.string().min(2, 'Area/City is required'),
  status: z.nativeEnum(DealerStatus).default(DealerStatus.ACTIVE),
});

export const updateDealerSchema = createDealerSchema.partial();

export const updateDealerStatusSchema = z.object({
  status: z.nativeEnum(DealerStatus),
});

export const createCustomerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  primaryPhone: z.string().regex(/^[0-9+()-\s]{10,15}$/, 'Invalid primary phone number'),
  alternatePhone: z.string().regex(/^[0-9+()-\s]{10,15}$/, 'Invalid alternate phone number').optional().nullable(),
  addressLine1: z.string().min(5, 'Address line 1 is required'),
  addressLine2: z.string().optional().nullable(),
  landmark: z.string().optional().nullable(),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  areaRoute: z.string().min(2, 'Area/Route is required'),
  photoUrl: z.string().optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const onboardCustomerSchema = z.object({
  customer: createCustomerSchema,
  loan: z.object({
    principalAmount: z.number().positive('Principal amount must be positive'),
    downPayment: z.number().min(0, 'Down payment cannot be negative').default(0),
    annualInterestRate: z.number().min(0, 'Interest rate cannot be negative'),
    interestCalcMethod: z.nativeEnum(InterestMethod).default(InterestMethod.FLAT_RATE),
    tenureMonths: z.number().int('Tenure must be an integer').positive('Tenure must be a positive integer'),
    installmentFrequency: z.nativeEnum(RepaymentFrequency).default(RepaymentFrequency.MONTHLY),
    disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Disbursement date must be YYYY-MM-DD'),
    firstEmiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'First EMI date must be YYYY-MM-DD').optional(),
    emiStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'EMI Start Date must be YYYY-MM-DD').optional(),
    dealerId: z.string().uuid('Invalid dealer ID').optional().nullable(),
    assignedAgentId: z.string().uuid('Invalid agent ID').optional().nullable(),
    deviceBrand: z.string().max(100).optional().nullable(),
    deviceModel: z.string().max(100).optional().nullable(),
    deviceName: z.string().max(150).optional().nullable(),
    imei1: z.string().max(50).optional().nullable(),
    imei2: z.string().max(50).optional().nullable(),
    deviceStatus: z.string().max(50).optional().nullable(),
    status: z.nativeEnum(LoanStatus).optional(),
  }).superRefine((data, ctx) => {
    if (!isValidCalendarDate(data.disbursementDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disbursementDate'],
        message: 'Disbursement date must be a valid calendar date',
      });
    }
    const emiStart = data.firstEmiDate || data.emiStartDate;
    if (emiStart) {
      if (!isValidCalendarDate(emiStart)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['firstEmiDate'],
          message: 'EMI Start Date must be a valid calendar date',
        });
      } else if (data.disbursementDate && emiStart < data.disbursementDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['firstEmiDate'],
          message: 'EMI Start Date cannot be earlier than loan disbursement date',
        });
      }
    }
  }).optional(),
});
export type OnboardCustomerInput = z.infer<typeof onboardCustomerSchema>;

const loanCalculationFields = {
  principalAmount: z.number().positive('Principal amount must be positive'),
  downPayment: z.number().min(0, 'Down payment cannot be negative').default(0),
  annualInterestRate: z.number().min(0, 'Interest rate cannot be negative'),
  interestCalcMethod: z.nativeEnum(InterestMethod).default(InterestMethod.FLAT_RATE),
  tenureMonths: z.number().int('Tenure must be an integer').positive('Tenure must be a positive integer'),
  installmentFrequency: z.nativeEnum(RepaymentFrequency).default(RepaymentFrequency.MONTHLY),
  disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Disbursement date must be YYYY-MM-DD'),
  firstEmiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'First EMI date must be YYYY-MM-DD').optional(),
  emiStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'EMI Start Date must be YYYY-MM-DD').optional(),
};

function refineLoanDates(data: { disbursementDate?: string; firstEmiDate?: string; emiStartDate?: string }, ctx: z.RefinementCtx) {
  if (data.disbursementDate && !isValidCalendarDate(data.disbursementDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['disbursementDate'],
      message: 'Disbursement date must be a valid calendar date',
    });
  }
  const emiStart = data.firstEmiDate || data.emiStartDate;
  if (emiStart) {
    if (!isValidCalendarDate(emiStart)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstEmiDate'],
        message: 'EMI Start Date must be a valid calendar date',
      });
    } else if (data.disbursementDate && emiStart < data.disbursementDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['firstEmiDate'],
        message: 'EMI Start Date cannot be earlier than loan disbursement date',
      });
    }
  }
}

export const calculateLoanSchema = z.object(loanCalculationFields).superRefine(refineLoanDates);

export const createLoanSchema = z.object({
  ...loanCalculationFields,
  customerId: z.string().uuid('Invalid customer ID'),
  assignedAgentId: z.string().uuid('Invalid agent ID').optional().nullable(),
  dealerId: z.string().uuid('Invalid dealer ID').optional().nullable(),
  deviceBrand: z.string().max(100).optional().nullable(),
  deviceModel: z.string().max(100).optional().nullable(),
  deviceName: z.string().max(150).optional().nullable(),
  imei1: z.string().max(50).optional().nullable(),
  imei2: z.string().max(50).optional().nullable(),
  deviceStatus: z.string().max(50).optional().nullable(),
  status: z.nativeEnum(LoanStatus).optional(),
}).superRefine(refineLoanDates);

export const approveLoanSchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

export const rejectLoanSchema = z.object({
  reason: z.string().min(3, 'Rejection reason must be at least 3 characters').max(500),
});

export const disburseLoanSchema = z.object({
  disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Disbursement date must be YYYY-MM-DD').optional(),
  firstEmiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'First EMI date must be YYYY-MM-DD').optional(),
  assignedAgentId: z.string().uuid('Invalid agent ID').optional().nullable(),
});

export const recordPaymentSchema = z.object({
  loanId: z.string().uuid('Invalid loan ID'),
  emiId: z.string().uuid('Invalid EMI ID').optional().nullable(),
  customerId: z.string().uuid('Invalid customer ID'),
  amount: z.number().positive('Payment amount must be greater than 0'),
  paymentMode: z.nativeEnum(PaymentMode).default(PaymentMode.CASH),
  collectionSource: z.nativeEnum(CollectionSource).optional(),
  dealerId: z.string().uuid('Invalid dealer ID').optional().nullable(),
  agentId: z.string().uuid('Invalid agent ID').optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  idempotencyKey: z.string().min(5).max(150).optional(),
}).superRefine((data, ctx) => {
  if (data.collectionSource === CollectionSource.DIRECT_CUSTOMER) {
    if (data.dealerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dealerId'],
        message: 'Dealer ID must not be provided for direct customer payments',
      });
    }
    if (data.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentId'],
        message: 'Agent ID must not be provided for direct customer payments',
      });
    }
  } else if (data.collectionSource === CollectionSource.DEALER) {
    if (!data.dealerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dealerId'],
        message: 'Dealer ID is required for partner store payments',
      });
    }
    if (data.agentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agentId'],
        message: 'Agent ID must not be provided for partner store payments',
      });
    }
  } else if (data.collectionSource === CollectionSource.RECOVERY_AGENT) {
    if (data.dealerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dealerId'],
        message: 'Dealer ID must not be provided for recovery agent payments',
      });
    }
  }
});

export const reversePaymentSchema = z.object({
  paymentId: z.string().uuid('Invalid payment ID').optional(),
  reason: z.string().min(5, 'Reversal reason is mandatory and must be at least 5 characters'),
});

export const paymentPreviewQuerySchema = z.object({
  loanId: z.string().uuid('Invalid loan ID'),
  installmentId: z.string().uuid('Invalid installment ID').optional(),
  amount: z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return undefined;
      const num = Number(val);
      return isNaN(num) ? val : num;
    }, z.number().nonnegative('Amount cannot be negative'))
    .optional(),
});
export type PaymentPreviewQuery = z.infer<typeof paymentPreviewQuerySchema>;


export const createCallLogSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  loanId: z.string().uuid('Invalid loan ID').optional().nullable(),
  emiId: z.string().uuid('Invalid EMI ID').optional().nullable(),
  outcome: z.nativeEnum(CallOutcome),
  promisedPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().min(2, 'Call outcome notes are required'),
  contactPhoneUsed: z.string().min(5, 'Contact phone used is required'),
});

export const createAssignmentSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  customerId: z.string().uuid('Invalid customer ID').optional().nullable(),
  areaRoute: z.string().min(2).optional().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const assignLoanAgentSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  notes: z.string().optional().nullable(),
});

export const unassignLoanAgentSchema = z.object({
  reason: z.string().optional().nullable(),
});

export const kycUploadInitSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  docType: z.nativeEnum(KYCType),
  fileName: z.string().min(1),
  mimeType: z.string().regex(/^(image\/(jpeg|png|webp)|application\/pdf)$/, 'Only JPEG, PNG, WEBP, or PDF files are permitted'),
  fileSizeBytes: z.number().int().positive().max(10 * 1024 * 1024, 'File size must not exceed 10 MB'),
});

export const kycConfirmSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  docType: z.nativeEnum(KYCType),
  docNumber: z.string().min(2).max(50).optional().nullable(),
  storageKey: z.string().min(5),
  fileMimeType: z.string(),
  fileSizeBytes: z.number().int().positive(),
});

export const dealerCollectionsFilterSchema = z.object({
  dealerId: z.string().uuid('Invalid dealer ID').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  search: z.string().optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100)).optional(),
});

export const createDealerSettlementSchema = z.object({
  dealerId: z.string().uuid('Invalid dealer ID'),
  amount: z.number().positive('Settlement amount must be greater than 0'),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Settlement date must be YYYY-MM-DD'),
  paymentMethod: z.string().min(2, 'Payment method is required'),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  allocations: z
    .array(
      z.object({
        paymentId: z.string().uuid('Invalid payment ID'),
        amountAllocated: z.number().positive('Allocation amount must be greater than 0'),
      })
    )
    .optional(),
});

export const dealerSettlementsFilterSchema = z.object({
  dealerId: z.string().uuid('Invalid dealer ID').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  status: z.nativeEnum(SettlementStatus).optional(),
  search: z.string().optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100)).optional(),
});

export const reverseDealerSettlementSchema = z.object({
  reason: z.string().min(5, 'Reversal reason is mandatory and must be at least 5 characters'),
});

export const agentCollectionsFilterSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID').optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  search: z.string().optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100)).optional(),
});

export const directCollectionsFilterSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  paymentMode: z.nativeEnum(PaymentMode).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  search: z.string().optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100)).optional(),
});

export const paymentsFilterSchema = z.object({
  collectionSource: z.nativeEnum(CollectionSource).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  paymentMode: z.nativeEnum(PaymentMode).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  search: z.string().optional(),
  loanId: z.string().uuid('Invalid loan ID').optional(),
  customerId: z.string().uuid('Invalid customer ID').optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(100)).optional(),
});

export const financeDashboardFilterSchema = z.object({
  preset: z.enum([
    'today',
    'yesterday',
    'this-week',
    'this-month',
    'last-month',
    'this-quarter',
    'this-year',
    'custom',
    'all',
  ]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
});

export const financeReportFilterSchema = z.object({
  category: z.enum(['collections', 'loans', 'dealer', 'recovery']).default('collections'),
  reportType: z.enum([
    'all-collections',
    'direct-collections',
    'dealer-collections',
    'agent-collections',
    'disbursements',
    'active-portfolio',
    'closed-loans',
    'overdue-loans',
    'dealer-reconciliation',
    'dealer-settlements',
    'dealer-outstanding',
    'agent-performance',
    'recovery-queue',
  ]).default('all-collections'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'End date must be YYYY-MM-DD').optional(),
  dealerId: z.string().uuid('Invalid dealer ID').optional(),
  agentId: z.string().uuid('Invalid agent ID').optional(),
  collectionSource: z.nativeEnum(CollectionSource).optional(),
  paymentMode: z.nativeEnum(PaymentMode).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  loanStatus: z.nativeEnum(LoanStatus).optional(),
  bucket: z.string().optional(),
  search: z.string().optional(),
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z.preprocess((val) => (val ? Number(val) : 25), z.number().int().min(1).max(200)).optional(),
});


