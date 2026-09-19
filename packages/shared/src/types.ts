import {
  UserRole,
  UserStatus,
  KYCType,
  KYCStatus,
  InterestMethod,
  RepaymentFrequency,
  LoanStatus,
  EMIStatus,
  PaymentMode,
  PaymentStatus,
  CallOutcome,
  NotificationChannel,
  NotificationType,
  NotificationStatus,
} from './enums';

export interface IUser {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  assignedBranch?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ICustomer {
  id: string;
  customerCode: string;
  fullName: string;
  primaryPhone: string;
  alternatePhone?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  areaRoute: string;
  photoUrl?: string | null;
  isActive: boolean;
  activeLoansCount?: number;
  totalOutstanding?: number;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  kycDocuments?: IKYCDocument[];
  loans?: ILoan[];
  assignments?: ICollectionAssignment[];
}

export interface IKYCDocument {
  id: string;
  customerId: string;
  docType: KYCType;
  docNumberMasked?: string | null;
  docNumberHash?: string | null;
  storageKey: string;
  fileMimeType: string;
  fileSizeBytes: number;
  status: KYCStatus;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  downloadUrl?: string; // transient signed URL for admin
}

export interface ILoan {
  id: string;
  loanAccountNo: string;
  customerId: string;
  customer?: ICustomer;
  principalAmount: number | string;
  downPayment: number | string;
  netDisbursedAmount: number | string;
  annualInterestRate: number | string; // e.g. 0.12 or 12.0%
  interestCalcMethod: InterestMethod;
  tenureMonths: number;
  installmentFrequency: RepaymentFrequency;
  totalInstallments: number;
  emiAmount: number | string;
  totalInterest: number | string;
  totalPayable: number | string;
  totalPaid: number | string;
  outstandingBalance: number | string;
  disbursementDate: string;
  firstEmiDate: string;
  maturityDate: string;
  assignedAgentId?: string | null;
  assignedAgent?: IUser | null;
  status: LoanStatus;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  installments?: IEMIInstallment[];
}

export interface IEMIInstallment {
  id: string;
  loanId: string;
  customerId: string;
  installmentNumber: number;
  dueDate: string;
  principalComponent: number | string;
  interestComponent: number | string;
  expectedAmount: number | string;
  paidAmount: number | string;
  remainingAmount: number | string;
  penaltyAmount: number | string;
  status: EMIStatus;
  daysOverdue: number;
  lastPaymentDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IPayment {
  id: string;
  receiptNumber: string;
  loanId: string;
  emiId?: string | null;
  customerId: string;
  amount: number | string;
  paymentMode: PaymentMode;
  referenceNumber?: string | null;
  collectedByAgentId: string;
  collectedByAgent?: IUser;
  paymentTimestamp: string;
  status: PaymentStatus;
  notes?: string | null;
  isReversal: boolean;
  reversedPaymentId?: string | null;
  reversalReason?: string | null;
  idempotencyKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICallLog {
  id: string;
  customerId: string;
  customer?: ICustomer;
  loanId?: string | null;
  emiId?: string | null;
  agentId: string;
  agent?: IUser;
  callTimestamp: string;
  outcome: CallOutcome;
  promisedPaymentDate?: string | null;
  nextFollowUpDate?: string | null;
  notes: string;
  contactPhoneUsed: string;
  createdAt: string;
}

export interface ICollectionAssignment {
  id: string;
  agentId: string;
  agent?: IUser;
  customerId?: string | null;
  areaRoute?: string | null;
  assignedBy: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface IAuditLog {
  id: string;
  userId?: string | null;
  user?: IUser | null;
  action: string;
  entity: string;
  entityId: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

export interface INotification {
  id: string;
  recipientCustomerId?: string | null;
  recipientUserId?: string | null;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  status: NotificationStatus;
  idempotencyKey?: string | null;
  scheduledFor: string;
  sentAt?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface ISystemSetting {
  key: string;
  value: Record<string, unknown> | string | number | boolean;
  description?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

// API Response Envelopes
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    [key: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: Array<{ field?: string; issue: string }>;
    traceId?: string;
  };
  timestamp: string;
}

// Mobile Agent Queue Item
export interface IAgentQueueItem {
  installmentId: string;
  loanId: string;
  loanAccountNo: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  primaryPhone: string;
  areaRoute: string;
  addressSummary: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  expectedAmount: number;
  paidAmount: number;
  remainingAmount: number;
  penaltyAmount: number;
  totalOutstandingLoan: number;
  status: EMIStatus;
  daysOverdue: number;
  lastCallOutcome?: CallOutcome | null;
  promisedPaymentDate?: string | null;
}

// Dashboard Aggregates
export interface IDashboardStats {
  totalActiveLoans: number;
  totalOutstandingAmount: number;
  todayExpectedCollection: number;
  todayCollectedAmount: number;
  todayPendingCollection: number;
  totalOverdueAmount: number;
  totalOverdueCustomers: number;
  collectionEfficiencyPercent: number;
  agingBuckets: {
    bucket0To30: number;
    bucket31To60: number;
    bucket61To90: number;
    bucket90Plus: number;
  };
  recentPayments: IPayment[];
}
