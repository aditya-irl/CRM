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
  DealerStatus,
  CollectionSource,
  SettlementStatus,
  SettlementPaymentMethod,
  PenaltyStatus,
} from './enums';

export interface IDealer {
  id: string;
  dealerCode: string;
  storeName: string;
  ownerName: string;
  phone: string;
  alternatePhone?: string | null;
  email?: string | null;
  address: string;
  areaCity: string;
  status: DealerStatus;
  userId?: string | null;
  userLoginId?: string | null;
  userStatus?: UserStatus | null;
  mustChangePassword?: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  totalCustomersCount?: number;
  activeLoansCount?: number;
  closedLoansCount?: number;
}

export interface IDealerDashboardMetrics {
  dealer: IDealer;
  metrics: {
    totalCustomers: number;
    activeLoans: number;
    closedLoans: number;
    totalFinancedAmount: number;
    totalOutstandingBalance: number;
    totalCollectedAmount: number;
    unsettledCollectionAmount: number;
    totalSettledAmount: number;
  };
  recentLoans: Array<{
    id: string;
    loanAccountNo: string;
    customerName: string;
    customerCode: string;
    primaryPhone: string;
    principalAmount: number;
    emiAmount: number;
    outstandingBalance: number;
    status: string;
    disbursementDate: string;
  }>;
  recentCollections: Array<{
    id: string;
    receiptNumber: string;
    customerName: string;
    loanAccountNo: string;
    amount: number;
    paymentDate: string;
    paymentMode: string;
    status: string;
    settlementStatus: string;
  }>;
  recentSettlements: Array<{
    id: string;
    settlementReference: string;
    totalAmount: number;
    settlementDate: string;
    paymentMethod: string;
    status: string;
  }>;
}

export interface IDealerLoginAccountResponse {
  dealerId: string;
  loginId: string;
  temporaryPassword: string;
  mustChangePassword: boolean;
  user?: {
    id: string;
    email: string;
    role: UserRole;
    dealerId: string;
  };
}

export interface IUser {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  assignedBranch?: string | null;
  dealerId?: string | null;
  mustChangePassword?: boolean;
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
  dealerId?: string | null;
  dealer?: IDealer | null;
  dealerStoreName?: string | null;
  dealerCode?: string | null;
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
  penalties?: IEmiPenalty[];
}

export interface IEmiPenalty {
  id: string;
  emiInstallmentId: string;
  loanId: string;
  amount: number;
  paidAmount: number;
  status: PenaltyStatus;
  reason: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  reversedBy?: string | null;
  reversedByName?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
}

export const SYSTEM_SETTING_KEYS = {
  ALLOW_DEALER_PENALTY: 'ALLOW_DEALER_PENALTY',
} as const;

export interface IPayment {
  id: string;
  receiptNumber: string;
  loanId: string;
  emiId?: string | null;
  customerId: string;
  amount: number | string;
  paymentMode: PaymentMode;
  collectionSource: CollectionSource;
  dealerId?: string | null;
  agentId?: string | null;
  dealerStoreName?: string | null;
  dealerCode?: string | null;
  agentName?: string | null;
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

export interface IAuditFieldChange {
  field: string;
  previousValue: any;
  newValue: any;
}

export interface IAuditLogDetail {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  status: string;
  actor: {
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    userRole: string | null;
    dealerId?: string | null;
    dealerStoreName?: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  };
  target: {
    entity: string;
    entityId: string;
    entityAccountNo?: string | null;
    customerId?: string | null;
    customerName?: string | null;
    loanId?: string | null;
    loanAccountNo?: string | null;
    dealerId?: string | null;
    dealerName?: string | null;
  };
  previousState?: Record<string, any> | null;
  newState?: Record<string, any> | null;
  changes?: IAuditFieldChange[];
  requestDetails?: {
    httpMethod?: string | null;
    endpoint?: string | null;
    requestId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  metadata?: Record<string, any> | null;
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
  customerPhone?: string;
  areaRoute: string;
  addressSummary: string;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  expectedAmount: number;
  emiAmount?: number;
  paidAmount: number;
  remainingAmount: number;
  penaltyAmount: number;
  totalDue?: number;
  totalOutstandingLoan: number;
  status: EMIStatus;
  daysOverdue: number;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  lastPaymentDate?: string | null;
  lastPaymentAmount?: number;
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

// Dealer Collection Ledger Interfaces
export interface IDealerCollectionMetric {
  dealerId: string;
  dealerCode: string;
  storeName: string;
  ownerName?: string;
  phone?: string;
  areaCity?: string;
  status: DealerStatus;
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  monthCollections: number;
  averageCollection: number;
}

export interface IDealerCollectionSummary {
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  monthCollections: number;
  averageCollection: number;
  dealerBreakdown: IDealerCollectionMetric[];
}

export interface IDealerCollectionRecord {
  id: string;
  receiptNumber: string;
  loanId: string;
  loanAccountNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerPhone: string;
  areaRoute: string;
  amount: number;
  paymentMode: PaymentMode;
  collectionSource: CollectionSource;
  dealerId: string;
  dealerStoreName: string;
  dealerCode: string;
  paymentTimestamp: string;
  status: PaymentStatus;
  isReversal: boolean;
  referenceNumber?: string | null;
  notes?: string | null;
}

export interface IDealerCollectionLedgerResponse {
  summary: IDealerCollectionSummary;
  records: IDealerCollectionRecord[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

// Dealer Settlement & Reconciliation Interfaces
export interface IDealerSettlementAllocation {
  id: string;
  settlementId: string;
  paymentId: string;
  amountAllocated: number;
  receiptNumber: string;
  customerName: string;
  customerCode?: string;
  loanAccountNo: string;
  paymentDate: string;
  amountCollected: number;
  createdAt: string;
}

export interface IDealerSettlement {
  id: string;
  settlementNumber: string;
  dealerId: string;
  dealerStoreName: string;
  dealerCode: string;
  ownerName?: string;
  phone?: string;
  amount: number;
  settlementDate: string;
  paymentMethod: SettlementPaymentMethod | string;
  referenceNumber?: string | null;
  notes?: string | null;
  status: SettlementStatus;
  isReversal: boolean;
  reversalReason?: string | null;
  reversedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  allocationsCount?: number;
  allocations?: IDealerSettlementAllocation[];
}

export interface IDealerReconciliation {
  dealerId: string;
  dealerCode: string;
  storeName: string;
  ownerName: string;
  phone: string;
  areaCity: string;
  status: DealerStatus;
  totalCollections: number;
  totalSettled: number;
  outstandingSettlement: number;
  settlementCount: number;
  lastSettlementDate?: string | null;
  reconciliationStatus: 'FULLY_RECONCILED' | 'PENDING_SETTLEMENT' | 'NO_COLLECTIONS';
}

export interface IDealerSettlementsSummary {
  totalCollections: number;
  totalSettled: number;
  outstandingSettlement: number;
  settlementCount: number;
  dealerReconciliation: IDealerReconciliation[];
}

export interface IDealerUnsettledCollection {
  paymentId: string;
  receiptNumber: string;
  loanId: string;
  loanAccountNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerPhone: string;
  paymentDate: string;
  paymentMode: PaymentMode;
  amountCollected: number;
  amountSettled: number;
  amountRemaining: number;
}

export interface IDealerSettlementsLedgerResponse {
  summary: IDealerSettlementsSummary;
  records: IDealerSettlement[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface IAgentCollectionMetric {
  agentId: string;
  agentName: string;
  agentEmail?: string;
  agentPhone?: string;
  status: string;
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  todayCount: number;
  monthCollections: number;
  monthCount: number;
  averageCollection: number;
}

export interface IAgentCollectionSummary {
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  todayCount: number;
  monthCollections: number;
  monthCount: number;
  averageCollection: number;
  agentBreakdown: IAgentCollectionMetric[];
}

export interface IAgentCollectionRecord {
  id: string;
  receiptNumber: string;
  loanId: string;
  loanAccountNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerPhone?: string;
  areaRoute?: string;
  amount: number;
  paymentMode: PaymentMode;
  collectionSource: CollectionSource;
  agentId: string;
  agentName: string;
  paymentTimestamp: string;
  status: PaymentStatus;
  isReversal: boolean;
  reversalReason?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
}

export interface IAgentCollectionLedgerResponse {
  summary: IAgentCollectionSummary;
  records: IAgentCollectionRecord[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface IDirectCollectionSummary {
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  todayCount: number;
  monthCollections: number;
  monthCount: number;
  averageCollection: number;
}

export interface IDirectCollectionRecord {
  id: string;
  receiptNumber: string;
  loanId: string;
  loanAccountNo: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  customerPhone?: string;
  areaRoute?: string;
  amount: number;
  paymentMode: PaymentMode;
  collectionSource: CollectionSource;
  paymentTimestamp: string;
  status: PaymentStatus;
  isReversal: boolean;
  reversalReason?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
}

export interface IDirectCollectionDetail extends IDirectCollectionRecord {
  allocations?: Array<{
    id: string;
    installmentNumber: number;
    principalComponent: number;
    interestComponent: number;
    penaltyComponent: number;
    totalAmount: number;
  }>;
  customer?: {
    id: string;
    name: string;
    code: string;
    phone: string;
    address?: string;
    route?: string;
  };
  loan?: {
    id: string;
    accountNo: string;
    principalAmount: number;
    outstandingBalance: number;
  };
}

export interface IDirectCollectionLedgerResponse {
  summary: IDirectCollectionSummary;
  records: IDirectCollectionRecord[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

export interface IPaymentsSummary {
  totalCollections: number;
  paymentCount: number;
  todayCollections: number;
  todayCount: number;
  monthCollections: number;
  monthCount: number;
  averageCollection: number;
  sourceBreakdown: {
    directCustomer: { amount: number; count: number };
    dealer: { amount: number; count: number };
    recoveryAgent: { amount: number; count: number };
  };
}

export interface IPaymentDetail extends IPayment {
  customerName?: string;
  customerCode?: string;
  customerPhone?: string;
  customerAddress?: string;
  areaRoute?: string;
  loanAccountNo?: string;
  loanPrincipal?: number;
  loanOutstanding?: number;
  loanStatus?: string;
  financedItem?: string;
  customer?: {
    id: string;
    name: string;
    code: string;
    phone?: string;
    address?: string;
    route?: string;
  };
  loan?: {
    id: string;
    accountNo: string;
    principalAmount?: number;
    outstandingBalance?: number;
    status?: string;
  };
  dealer?: {
    id: string;
    storeName: string;
    code: string;
    phone?: string;
  } | null;
  agent?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  allocations?: Array<{
    id: string;
    installmentNumber: number;
    principalComponent: number;
    interestComponent: number;
    penaltyComponent: number;
    totalAmount: number;
  }>;
  reversalAudit?: {
    reversedAt?: string;
    reversedBy?: string;
    reversalReason?: string;
  } | null;
  timeline?: Array<{
    event: string;
    timestamp: string;
    description: string;
  }>;
}

export interface IPaymentsLedgerResponse {
  payments: IPaymentDetail[];
  summary: IPaymentsSummary;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Finance Dashboard & Reports Interfaces (Task 8)
export interface IFinanceDashboardStats {
  period: {
    startDate: string;
    endDate: string;
    preset?: string;
  };
  topKpis: {
    totalDisbursed: number;
    disbursedLoanCount: number;
    activePortfolio: number;
    activeLoanCount: number;
    totalCollections: number;
    collectionCount: number;
    totalOverdueAmount: number;
    overdueLoanCount: number;
    overdueCustomerCount: number;
    collectionEfficiencyPercent: number;
    totalDueAmount: number;
  };
  sourceBreakdown: {
    directCustomer: { amount: number; count: number; sharePercent: number };
    dealer: { amount: number; count: number; sharePercent: number };
    recoveryAgent: { amount: number; count: number; sharePercent: number };
  };
  trends: {
    collections: Array<{
      date: string;
      total: number;
      direct: number;
      dealer: number;
      agent: number;
    }>;
    disbursements: Array<{
      date: string;
      amount: number;
      count: number;
    }>;
  };
  portfolioSummary: {
    totalOutstandingPrincipal: number;
    totalOutstandingInterest: number;
    totalOverdue: number;
    activeLoans: number;
    closedLoans: number;
    overdueLoans: number;
    totalCustomers: number;
  };
  agingBuckets: {
    current: { count: number; amount: number };
    dpd1To30: { count: number; amount: number };
    dpd31To60: { count: number; amount: number };
    dpd61To90: { count: number; amount: number };
    dpd90Plus: { count: number; amount: number };
  };
  dealerReconciliation: {
    totalCollectedThroughDealers: number;
    totalDealerSettled: number;
    outstandingDealerRemittance: number;
    unsettledDealersCount: number;
    dealers: Array<{
      dealerId: string;
      storeName: string;
      dealerCode: string;
      ownerName?: string;
      customerCollections: number;
      settled: number;
      outstanding: number;
      collectionCount: number;
      lastSettlementDate?: string | null;
      status: string;
    }>;
  };
  recoveryAgentSummary: {
    totalAgentCollections: number;
    paymentCount: number;
    todayCollections: number;
    monthCollections: number;
    agents: Array<{
      agentId: string;
      agentName: string;
      agentPhone?: string;
      collections: number;
      paymentCount: number;
      todayCollections: number;
      monthCollections: number;
    }>;
  };
  directCustomerSummary: {
    totalDirectCollections: number;
    paymentCount: number;
    todayCollections: number;
    monthCollections: number;
    averagePayment: number;
  };
  overdueSummary: {
    totalOverdueAmount: number;
    overdueLoanCount: number;
    overdueCustomerCount: number;
    averageOverdueAmount: number;
    recoveryQueue: {
      totalAccounts: number;
      dpd1To30: number;
      dpd31To60: number;
      dpd61To90: number;
      dpd90Plus: number;
      assignedCount: number;
      unassignedCount: number;
    };
  };
  operationalMetrics: {
    averageLoanAmount: number;
    averageEmiAmount: number;
    averagePaymentAmount: number;
    activeCustomersCount: number;
    activeDealersCount: number;
    activeAgentsCount: number;
  };
  recentCollections: Array<{
    id: string;
    receiptNumber: string;
    paymentTimestamp: string;
    customerName: string;
    customerCode?: string;
    loanAccountNo: string;
    amount: number;
    collectionSource: CollectionSource;
    collectedThrough: string;
    paymentMode: PaymentMode;
    status: PaymentStatus;
    isReversal: boolean;
  }>;
  recentSettlements: Array<{
    id: string;
    settlementNumber: string;
    settlementDate: string;
    dealerStoreName: string;
    dealerCode: string;
    amount: number;
    paymentMethod: string;
    status: string;
  }>;
}

export type FinanceReportCategory = 'collections' | 'loans' | 'dealer' | 'recovery';

export type FinanceReportType = 
  | 'all-collections'
  | 'direct-collections'
  | 'dealer-collections'
  | 'agent-collections'
  | 'disbursements'
  | 'active-portfolio'
  | 'closed-loans'
  | 'overdue-loans'
  | 'dealer-reconciliation'
  | 'dealer-settlements'
  | 'dealer-outstanding'
  | 'agent-performance'
  | 'recovery-queue';

export interface IFinanceReportSummary {
  totalAmount: number;
  recordCount: number;
  averageAmount: number;
  startDate?: string;
  endDate?: string;
  extraMetrics?: Record<string, number | string>;
}

export interface IFinanceReportResponse {
  category: FinanceReportCategory;
  reportType: FinanceReportType;
  summary: IFinanceReportSummary;
  records: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}


