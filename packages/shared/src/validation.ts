import { z } from 'zod';
import {
  UserRole,
  KYCType,
  InterestMethod,
  RepaymentFrequency,
  PaymentMode,
  CallOutcome,
  LoanStatus,
} from './enums';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
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
  photoUrl: z.string().url().optional().nullable(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const calculateLoanSchema = z.object({
  principalAmount: z.number().positive('Principal amount must be positive'),
  downPayment: z.number().min(0, 'Down payment cannot be negative').default(0),
  annualInterestRate: z.number().min(0, 'Interest rate cannot be negative'),
  interestCalcMethod: z.nativeEnum(InterestMethod).default(InterestMethod.FLAT_RATE),
  tenureMonths: z.number().int().positive('Tenure must be a positive integer'),
  installmentFrequency: z.nativeEnum(RepaymentFrequency).default(RepaymentFrequency.MONTHLY),
  disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Disbursement date must be YYYY-MM-DD'),
  firstEmiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'First EMI date must be YYYY-MM-DD').optional(),
});

export const createLoanSchema = calculateLoanSchema.extend({
  customerId: z.string().uuid('Invalid customer ID'),
  assignedAgentId: z.string().uuid('Invalid agent ID').optional().nullable(),
  status: z.nativeEnum(LoanStatus).optional(),
});

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
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  idempotencyKey: z.string().min(5).max(150).optional(),
});

export const reversePaymentSchema = z.object({
  paymentId: z.string().uuid('Invalid payment ID').optional(),
  reason: z.string().min(5, 'Reversal reason is mandatory and must be at least 5 characters'),
});

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
