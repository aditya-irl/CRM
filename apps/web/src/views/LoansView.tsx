import React, { useEffect, useState } from 'react';
import { ApiClient } from '../services/api';
import {
  ILoan,
  ICustomer,
  formatINR,
  formatDateDDMMYYYY,
  normalizeNumericLeadingZeros,
  InterestMethod,
  RepaymentFrequency,
  LoanStatus,
  UserRole,
} from '@crm/shared';
import {
  Plus,
  Search,
  Banknote,
  Calculator,
  Calendar,
  X,
  CheckCircle2,
  AlertCircle,
  Eye,
  Receipt,
  Store,
  UserCheck,
  Building2,
  Printer,
  Link as LinkIcon,
  AlertTriangle,
  History,
  CreditCard,
} from 'lucide-react';
import { PortalLinkManager } from '../components/PortalLinkManager';
import { RecordPaymentModal } from '../components/RecordPaymentModal';

export const LoansView: React.FC = () => {
  const currentUser = ApiClient.getUser();
  const [loans, setLoans] = useState<ILoan[]>([]);
  const [customers, setCustomers] = useState<ICustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Portfolio Filtering & Approval Queue States
  const [activeStatusTab, setActiveStatusTab] = useState<'ALL' | 'PENDING_APPROVAL' | 'ACTIVE' | 'CLOSED' | 'REJECTED'>('ALL');
  const [pendingApprovalsList, setPendingApprovalsList] = useState<any[]>([]);
  const [rejectingLoan, setRejectingLoan] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Origination Modal State
  const [showOriginationModal, setShowOriginationModal] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [principalAmount, setPrincipalAmount] = useState<number>(50000);
  const [downPayment, setDownPayment] = useState<number>(0);
  const [annualRate, setAnnualRate] = useState<number>(1.0);
  const [calcMethod, setCalcMethod] = useState<InterestMethod>(InterestMethod.FLAT_RATE);
  const [tenureMonths, setTenureMonths] = useState<number>(12);
  const [frequency, setFrequency] = useState<RepaymentFrequency>(RepaymentFrequency.MONTHLY);
  const [disbDate, setDisbDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [emiStartDate, setEmiStartDate] = useState<string>('');
  const [originationError, setOriginationError] = useState<string | null>(null);

  const [previewSchedule, setPreviewSchedule] = useState<any | null>(null);
  const [calculatingPreview, setCalculatingPreview] = useState(false);
  const [bookingLoan, setBookingLoan] = useState(false);

  // Detail Modal State
  const [selectedLoanDetail, setSelectedLoanDetail] = useState<{ loan: any; installments: any[]; payments: any[] } | null>(null);
  const [loanModalTab, setLoanModalTab] = useState<'schedule' | 'payments' | 'portal'>('schedule');
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Penalty Management States
  const [allowDealerPenalty, setAllowDealerPenalty] = useState(false);
  const [penaltyModalEmi, setPenaltyModalEmi] = useState<any | null>(null);
  const [penaltyAmount, setPenaltyAmount] = useState<string>('');
  const [penaltyReason, setPenaltyReason] = useState<string>('');
  const [submittingPenalty, setSubmittingPenalty] = useState(false);
  const [penaltyError, setPenaltyError] = useState<string | null>(null);
  const [penaltySuccess, setPenaltySuccess] = useState<string | null>(null);

  // Record Payment Modal State
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [selectedInstallmentForPayment, setSelectedInstallmentForPayment] = useState<any | null>(null);

  // Penalty History & Waiver States
  const [historyModalEmi, setHistoryModalEmi] = useState<any | null>(null);
  const [penaltyHistory, setPenaltyHistory] = useState<any | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Recovery Case Assignment States
  const [assigningLoan, setAssigningLoan] = useState<any | null>(null);
  const [activeAgentsList, setActiveAgentsList] = useState<any[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [assignmentNotes, setAssignmentNotes] = useState<string>('');
  const [submittingAssignment, setSubmittingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentSuccess, setAssignmentSuccess] = useState<string | null>(null);

  // Assignment History Modal
  const [historyLoan, setHistoryLoan] = useState<any | null>(null);
  const [assignmentHistoryList, setAssignmentHistoryList] = useState<any[]>([]);
  const [loadingAssignmentHistory, setLoadingAssignmentHistory] = useState(false);

  const canManageAssignment =
    currentUser?.role === UserRole.SUPER_ADMIN ||
    currentUser?.role === UserRole.ADMIN ||
    currentUser?.role === UserRole.BRANCH_MANAGER;

  const handleOpenAssignModal = async (loan: any) => {
    setAssigningLoan(loan);
    setSelectedAgentId(loan.assignedAgentId || loan.assigned_agent_id || '');
    setAssignmentNotes('');
    setAssignmentError(null);
    setAssignmentSuccess(null);
    try {
      const agents = await ApiClient.getAgents('ACTIVE');
      setActiveAgentsList(agents || []);
    } catch {
      setActiveAgentsList([]);
    }
  };

  const handleSubmitAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningLoan || !selectedAgentId) {
      setAssignmentError('Please select an active collection agent');
      return;
    }

    setSubmittingAssignment(true);
    setAssignmentError(null);
    setAssignmentSuccess(null);
    try {
      const res = await ApiClient.assignLoanAgent(assigningLoan.id, selectedAgentId, assignmentNotes || undefined);
      setAssignmentSuccess('Recovery case assigned successfully');

      // Update local loans state immediately
      setLoans((prev) =>
        prev.map((l) =>
          l.id === assigningLoan.id
            ? {
                ...l,
                assignedAgentId: res.data.assignedAgentId,
                assignedAgentName: res.data.assignedAgentName,
                assignedAgentPhone: res.data.assignedAgentPhone,
              }
            : l
        )
      );

      // If loan detail modal is open, refresh it
      if (selectedLoanDetail && selectedLoanDetail.loan.id === assigningLoan.id) {
        await handleViewLoan(assigningLoan.id, loanModalTab);
      }

      setTimeout(() => {
        setAssigningLoan(null);
      }, 900);
    } catch (err: any) {
      setAssignmentError(err.message || 'Failed to assign collection agent');
    } finally {
      setSubmittingAssignment(false);
    }
  };

  const handleUnassignLoan = async (loanId: string) => {
    if (!window.confirm('Are you sure you want to unassign this recovery case from the current agent?')) {
      return;
    }
    try {
      await ApiClient.unassignLoanAgent(loanId);
      alert('Loan unassigned successfully.');

      // Update local loans state immediately
      setLoans((prev) =>
        prev.map((l) =>
          l.id === loanId
            ? {
                ...l,
                assignedAgentId: null,
                assignedAgentName: null,
                assignedAgentPhone: null,
              }
            : l
        )
      );

      if (selectedLoanDetail && selectedLoanDetail.loan.id === loanId) {
        await handleViewLoan(loanId, loanModalTab);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to unassign recovery case');
    }
  };

  const handleOpenAssignmentHistory = async (loan: any) => {
    setHistoryLoan(loan);
    setLoadingAssignmentHistory(true);
    try {
      const history = await ApiClient.getLoanAssignmentHistory(loan.id);
      setAssignmentHistoryList(history || []);
    } catch (err: any) {
      alert(err.message || 'Failed to load assignment history');
    } finally {
      setLoadingAssignmentHistory(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role === UserRole.DEALER || currentUser?.role === UserRole.SUPER_ADMIN) {
      ApiClient.getDealerPenaltySetting()
        .then((res) => setAllowDealerPenalty(res.allowDealerPenalty))
        .catch(() => setAllowDealerPenalty(false));
    }
  }, [currentUser?.role]);

  const handleOpenAddPenalty = (inst: any) => {
    setPenaltyModalEmi(inst);
    setPenaltyAmount('');
    setPenaltyReason('Late payment beyond grace period');
    setPenaltyError(null);
    setPenaltySuccess(null);
  };

  const handleSubmitPenalty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!penaltyModalEmi || !selectedLoanDetail) return;
    setSubmittingPenalty(true);
    setPenaltyError(null);
    setPenaltySuccess(null);

    try {
      await ApiClient.addEmiPenalty(
        penaltyModalEmi.id,
        Number(penaltyAmount),
        penaltyReason
      );
      setPenaltySuccess('Penalty added successfully.');
      // Refresh EMI/payment data from server
      await handleViewLoan(selectedLoanDetail.loan.id, 'schedule');
      setTimeout(() => {
        setPenaltyModalEmi(null);
      }, 1000);
    } catch (err: any) {
      setPenaltyError(err.message || 'Failed to add penalty');
    } finally {
      setSubmittingPenalty(false);
    }
  };

  const handleOpenPenaltyHistory = async (inst: any) => {
    setHistoryModalEmi(inst);
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const data = await ApiClient.getEmiPenalties(inst.id);
      setPenaltyHistory(data);
    } catch (err: any) {
      setHistoryError(err.message || 'Failed to load penalty history');
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleReverseOrWaive = async (penaltyId: string, action: 'REVERSE' | 'WAIVE') => {
    const promptMsg = action === 'WAIVE' ? 'Enter reason for waiving this penalty:' : 'Enter reason for reversing this penalty:';
    const reason = window.prompt(promptMsg, 'Administrative correction');
    if (!reason || !reason.trim()) return;

    try {
      if (action === 'WAIVE') {
        await ApiClient.waivePenalty(penaltyId, reason.trim());
      } else {
        await ApiClient.reversePenalty(penaltyId, reason.trim());
      }
      alert(`Penalty ${action === 'WAIVE' ? 'waived' : 'reversed'} successfully.`);
      if (historyModalEmi) {
        const data = await ApiClient.getEmiPenalties(historyModalEmi.id);
        setPenaltyHistory(data);
      }
      if (selectedLoanDetail) {
        await handleViewLoan(selectedLoanDetail.loan.id, 'schedule');
      }
    } catch (err: any) {
      alert(err.message || `Failed to ${action.toLowerCase()} penalty`);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [loansData, custData, pendingData] = await Promise.all([
        ApiClient.getLoans(search || undefined),
        ApiClient.getCustomers(),
        (currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.BRANCH_MANAGER)
          ? ApiClient.getPendingApprovals().catch(() => [])
          : Promise.resolve([]),
      ]);
      setLoans(loansData);
      setCustomers(custData);
      setPendingApprovalsList(pendingData || []);
      if (custData.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(custData[0].id);
      }
    } catch (err) {
      console.error('Failed to load loans', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveLoan = async (loanId: string) => {
    if (!window.confirm('Are you sure you want to approve this dealer-originated loan? It will become approved and eligible for disbursement.')) {
      return;
    }
    setSubmittingDecision(true);
    try {
      await ApiClient.approveLoan(loanId);
      alert('Loan approved successfully.');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to approve loan');
    } finally {
      setSubmittingDecision(false);
    }
  };

  const handleOpenRejectModal = (loan: any) => {
    setRejectingLoan(loan);
    setRejectionReason('');
    setDecisionError(null);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingLoan || !rejectionReason.trim()) return;
    setSubmittingDecision(true);
    setDecisionError(null);
    try {
      await ApiClient.rejectLoan(rejectingLoan.id, rejectionReason.trim());
      alert('Loan rejected.');
      setRejectingLoan(null);
      loadData();
    } catch (err: any) {
      setDecisionError(err.message || 'Failed to reject loan');
    } finally {
      setSubmittingDecision(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePreviewCalculation = async () => {
    if (!emiStartDate) {
      setOriginationError('EMI Start Date is required. Select the date when the first EMI becomes due.');
      setPreviewSchedule(null);
      return;
    }
    if (emiStartDate < disbDate) {
      setOriginationError('EMI Start Date cannot be earlier than loan disbursement date.');
      setPreviewSchedule(null);
      return;
    }
    if (!tenureMonths || tenureMonths <= 0 || !Number.isInteger(Number(tenureMonths))) {
      setOriginationError('EMI Tenure must be a positive integer number of months.');
      setPreviewSchedule(null);
      return;
    }
    setOriginationError(null);
    setCalculatingPreview(true);
    try {
      const res = await ApiClient.calculateLoanPreview({
        principalAmount: Number(principalAmount),
        downPayment: Number(downPayment),
        annualInterestRate: Number(annualRate),
        interestCalcMethod: calcMethod,
        tenureMonths: Number(tenureMonths),
        installmentFrequency: frequency,
        disbursementDate: disbDate,
        firstEmiDate: emiStartDate,
      });
      setPreviewSchedule(res);
    } catch (err: any) {
      setOriginationError(err.message || 'Failed to calculate amortization preview');
      setPreviewSchedule(null);
    } finally {
      setCalculatingPreview(false);
    }
  };

  // Immediate preview update when any calculation parameter changes - guarantees no stale schedule
  useEffect(() => {
    if (!showOriginationModal) return;
    if (!emiStartDate || !tenureMonths || tenureMonths <= 0 || !principalAmount || principalAmount <= 0) {
      setPreviewSchedule(null);
      return;
    }
    if (emiStartDate < disbDate) {
      setPreviewSchedule(null);
      setOriginationError('EMI Start Date cannot be earlier than loan disbursement date.');
      return;
    }
    setOriginationError(null);

    const timer = setTimeout(() => {
      handlePreviewCalculation();
    }, 200);

    return () => clearTimeout(timer);
  }, [principalAmount, downPayment, annualRate, calcMethod, tenureMonths, frequency, disbDate, emiStartDate, showOriginationModal]);

  const handleBookLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) {
      alert('Please select a customer borrower');
      return;
    }
    if (!emiStartDate) {
      alert('EMI Start Date is required. Select the date when the first EMI becomes due.');
      return;
    }
    if (emiStartDate < disbDate) {
      alert('EMI Start Date cannot be earlier than loan disbursement date.');
      return;
    }
    if (!tenureMonths || tenureMonths <= 0 || !Number.isInteger(Number(tenureMonths))) {
      alert('EMI Tenure must be a positive integer number of months.');
      return;
    }
    setBookingLoan(true);
    try {
      await ApiClient.createLoan({
        customerId: selectedCustomerId,
        principalAmount: Number(principalAmount),
        downPayment: Number(downPayment),
        annualInterestRate: Number(annualRate),
        monthlyInterestRate: Number(annualRate),
        interestCalcMethod: calcMethod,
        tenureMonths: Number(tenureMonths),
        installmentFrequency: frequency,
        disbursementDate: disbDate,
        firstEmiDate: emiStartDate,
      } as any);
      setShowOriginationModal(false);
      setPreviewSchedule(null);
      setEmiStartDate('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to originate loan');
    } finally {
      setBookingLoan(false);
    }
  };

  const handleViewLoan = async (loanId: string, initialTab: 'schedule' | 'payments' | 'portal' = 'schedule') => {
    setLoadingDetail(true);
    try {
      const [loanData, paymentsData] = await Promise.all([
        ApiClient.getLoanDetail(loanId),
        ApiClient.listPayments(undefined, 1, 100, undefined, loanId).catch(() => []),
      ]);
      const loanObj = (loanData as any).loan || loanData;
      const installmentsList = (loanData as any).installments || [];
      setSelectedLoanDetail({
        loan: loanObj,
        installments: installmentsList,
        payments: paymentsData || [],
      });
      setLoanModalTab(initialTab);
    } catch (err: any) {
      alert(err.message || 'Failed to fetch loan details');
    } finally {
      setLoadingDetail(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>Loans & Amortization Portfolio</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Originate loans, preview deterministic amortization schedules, and track repayments.
          </p>
        </div>

        <button onClick={() => { setShowOriginationModal(true); setPreviewSchedule(null); setEmiStartDate(''); setOriginationError(null); }} className="btn btn-primary">
          <Plus size={15} />
          <span>Originate New Loan</span>
        </button>
      </div>

      {/* Portfolio Status Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveStatusTab('ALL')}
          className={`btn btn-sm ${activeStatusTab === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
        >
          All Loans ({loans.length})
        </button>
        {(currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.BRANCH_MANAGER) && (
          <button
            onClick={() => setActiveStatusTab('PENDING_APPROVAL')}
            className={`btn btn-sm ${activeStatusTab === 'PENDING_APPROVAL' ? 'btn-primary' : 'btn-secondary'}`}
            style={pendingApprovalsList.length > 0 ? { border: '1px solid var(--warning)', color: activeStatusTab === 'PENDING_APPROVAL' ? '#fff' : 'var(--warning-text)' } : {}}
          >
            Pending Approvals {pendingApprovalsList.length > 0 && <span className="badge badge-warning" style={{ marginLeft: 6 }}>{pendingApprovalsList.length}</span>}
          </button>
        )}
        <button
          onClick={() => setActiveStatusTab('ACTIVE')}
          className={`btn btn-sm ${activeStatusTab === 'ACTIVE' ? 'btn-primary' : 'btn-secondary'}`}
        >
          Active Loans ({loans.filter((l) => (l.status || (l as any).status) === 'ACTIVE').length})
        </button>
        <button
          onClick={() => setActiveStatusTab('CLOSED')}
          className={`btn btn-sm ${activeStatusTab === 'CLOSED' ? 'btn-primary' : 'btn-secondary'}`}
        >
          Closed ({loans.filter((l) => (l.status || (l as any).status) === 'CLOSED').length})
        </button>
        <button
          onClick={() => setActiveStatusTab('REJECTED')}
          className={`btn btn-sm ${activeStatusTab === 'REJECTED' ? 'btn-primary' : 'btn-secondary'}`}
        >
          Rejected ({loans.filter((l) => (l.status || (l as any).status) === 'REJECTED').length})
        </button>
      </div>

      {/* Loans Table */}
      <div className="table-container">
        {activeStatusTab === 'PENDING_APPROVAL' ? (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Loan Account</th>
                <th>Borrower</th>
                <th>Partner Store / Dealer</th>
                <th>Financed Principal</th>
                <th>Down Payment</th>
                <th>Monthly Rate</th>
                <th>Tenure</th>
                <th>EMI Amount</th>
                <th>Start Date</th>
                <th>KYC Status</th>
                <th>Super Admin Approval</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                    Loading pending approval queue...
                  </td>
                </tr>
              ) : pendingApprovalsList.length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    No dealer-originated loans pending approval. All applications are up to date.
                  </td>
                </tr>
              ) : (
                pendingApprovalsList.map((loan) => (
                  <tr key={loan.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {loan.loanAccountNo}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{loan.customerName}</div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{loan.customerPhone}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{loan.dealerStoreName}</div>
                      {loan.dealerCode && <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{loan.dealerCode}</div>}
                    </td>
                    <td className="mono font-bold" style={{ color: 'var(--primary)' }}>
                      {formatINR(loan.netDisbursedAmount || loan.principalAmount - loan.downPayment)}
                    </td>
                    <td className="mono">{formatINR(loan.downPayment)}</td>
                    <td className="mono font-semibold">{loan.monthlyInterestRate || loan.annualInterestRate}% /mo</td>
                    <td className="mono">{loan.tenureMonths} M</td>
                    <td className="mono font-bold" style={{ color: 'var(--warning-text)' }}>
                      {formatINR(loan.emiAmount)}
                    </td>
                    <td className="mono">{loan.firstEmiDate ? formatDateDDMMYYYY(loan.firstEmiDate) : 'Next month'}</td>
                    <td>
                      <span className={`badge ${loan.kycStatus === 'VERIFIED' ? 'badge-paid' : 'badge-warning'}`}>
                        {loan.kycStatus || 'SUBMITTED'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleApproveLoan(loan.id)}
                          className="btn btn-sm"
                          style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
                          title="Approve loan application"
                          disabled={submittingDecision}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleOpenRejectModal(loan)}
                          className="btn btn-danger btn-sm"
                          title="Reject loan with reason"
                          disabled={submittingDecision}
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => handleViewLoan(loan.id, 'schedule')}
                          className="btn btn-secondary btn-sm"
                          title="View loan schedule details"
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Loan Account</th>
                <th>Borrower</th>
                <th>Principal</th>
                <th>Tenure</th>
                <th>EMI</th>
                <th>Total Payable</th>
                <th>Total Paid</th>
                <th>Outstanding</th>
                <th>Status</th>
                <th>Assigned Agent</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                    Loading loan accounts...
                  </td>
                </tr>
              ) : (activeStatusTab === 'ALL' ? loans : loans.filter((l) => (l.status || (l as any).status) === activeStatusTab)).length === 0 ? (
                <tr>
                  <td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                    No {activeStatusTab.toLowerCase()} loans found.
                  </td>
                </tr>
              ) : (
                (activeStatusTab === 'ALL' ? loans : loans.filter((l) => (l.status || (l as any).status) === activeStatusTab)).map((loan) => {
                  const statusStr = loan.status || (loan as any).status;
                  const isPending = statusStr === 'PENDING_APPROVAL';
                  const isRejected = statusStr === 'REJECTED';
                  const reason = loan.rejectionReason || (loan as any).rejection_reason;
                  const agentName = loan.assignedAgentName || (loan as any).assigned_agent_name;
                  return (
                    <tr key={loan.id}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                        {loan.loanAccountNo || (loan as any).loan_account_no}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {(loan as any).customer_name || loan.customer?.fullName}
                      </td>
                      <td className="mono">{formatINR(loan.principalAmount || (loan as any).principal_amount)}</td>
                      <td className="mono">{loan.tenureMonths || (loan as any).tenure_months} M</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--warning-text)' }}>
                        {formatINR(loan.emiAmount || (loan as any).emi_amount)}
                      </td>
                      <td className="mono">{formatINR(loan.totalPayable || (loan as any).total_payable)}</td>
                      <td className="mono" style={{ color: 'var(--success-text)', fontWeight: 600 }}>
                        {formatINR(loan.totalPaid || (loan as any).total_paid)}
                      </td>
                      <td className="mono" style={{ color: 'var(--danger-text)', fontWeight: 700 }}>
                        {formatINR(loan.outstandingBalance || (loan as any).outstanding_balance)}
                      </td>
                      <td>
                        <span className={`badge ${isPending ? 'badge-warning' : isRejected ? 'badge-danger' : statusStr === 'APPROVED' ? 'badge-terracotta' : statusStr === 'CLOSED' ? 'badge-primary' : 'badge-paid'}`}>
                          {statusStr}
                        </span>
                        {isRejected && reason && (
                          <div style={{ fontSize: 11, color: 'var(--danger-text)', marginTop: 2, maxWidth: 160 }} title={reason}>
                            {reason}
                          </div>
                        )}
                      </td>
                      <td>
                        {agentName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <UserCheck size={11} />
                              <span>{agentName}</span>
                            </span>
                            {canManageAssignment && (
                              <button
                                onClick={() => handleOpenAssignModal(loan)}
                                className="btn btn-secondary btn-sm"
                                style={{ padding: '2px 6px', fontSize: 10 }}
                                title="Reassign collection agent"
                              >
                                Reassign
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="badge" style={{ background: 'var(--bg-surface-secondary)', color: 'var(--text-muted)' }}>
                              Unassigned
                            </span>
                            {canManageAssignment && (
                              <button
                                onClick={() => handleOpenAssignModal(loan)}
                                className="btn btn-primary btn-sm"
                                style={{ padding: '2px 6px', fontSize: 10 }}
                                title="Assign collection agent"
                              >
                                Assign
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {isPending && (currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.BRANCH_MANAGER) ? (
                            <>
                              <button
                                onClick={() => handleApproveLoan(loan.id)}
                                className="btn btn-sm"
                                style={{ background: 'var(--success)', color: '#fff', border: 'none' }}
                                title="Approve loan"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleOpenRejectModal(loan)}
                                className="btn btn-danger btn-sm"
                                title="Reject loan"
                              >
                                Reject
                              </button>
                            </>
                          ) : null}
                          <button
                            onClick={() => handleViewLoan(loan.id, 'schedule')}
                            className="btn btn-secondary btn-sm"
                            title="View complete EMI schedule"
                          >
                            <Eye size={13} />
                            <span>Schedule</span>
                          </button>
                          <button
                            onClick={() => handleViewLoan(loan.id, 'portal')}
                            className="btn btn-secondary btn-sm"
                            title="Manage Customer Portal Link"
                          >
                            <LinkIcon size={13} />
                            <span>Portal</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal 1: Loan Origination & Amortization Calculator */}
      {showOriginationModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 780, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Calculator size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Originate Loan & Preview Amortization</h3>
              </div>
              <button onClick={() => setShowOriginationModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleBookLoan} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Borrower Customer</label>
                  <select
                    className="form-select"
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    required
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.customerCode}) - {c.areaRoute}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Principal Amount (₹)</label>
                  <input
                    type="number"
                    className="form-input mono"
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(Number(e.target.value))}
                    onBlur={(e) => setPrincipalAmount(Number(normalizeNumericLeadingZeros(e.target.value)))}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Down Payment (₹)</label>
                  <input
                    type="number"
                    className="form-input mono"
                    value={downPayment}
                    onChange={(e) => setDownPayment(Number(e.target.value))}
                    onBlur={(e) => setDownPayment(Number(normalizeNumericLeadingZeros(e.target.value)))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Interest Rate (% per month)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    className="form-input mono"
                    value={annualRate}
                    onChange={(e) => setAnnualRate(Number(e.target.value))}
                    onBlur={(e) => setAnnualRate(Number(normalizeNumericLeadingZeros(e.target.value)))}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Monthly flat simple interest rate (e.g. 1.0% or 1.5%)
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Calculation Method</label>
                  <select
                    className="form-select"
                    value={calcMethod}
                    onChange={(e) => setCalcMethod(e.target.value as InterestMethod)}
                  >
                    <option value={InterestMethod.FLAT_RATE}>Flat Rate</option>
                    <option value={InterestMethod.REDUCING_BALANCE}>Reducing Balance</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Disbursement Date <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={disbDate}
                    onChange={(e) => setDisbDate(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    EMI Start Date <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={emiStartDate}
                    onChange={(e) => setEmiStartDate(e.target.value)}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Select the date when the first EMI becomes due.
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    EMI Tenure <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="form-input mono"
                    placeholder="e.g. 12"
                    value={tenureMonths}
                    onChange={(e) => setTenureMonths(Number(e.target.value))}
                    required
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Tenure in months (determines installment count).
                  </div>
                </div>
              </div>

              {originationError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-sm)', color: '#991b1b', fontSize: 13 }}>
                  <AlertCircle size={16} />
                  <span>{originationError}</span>
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={handlePreviewCalculation}
                  disabled={calculatingPreview}
                  className="btn btn-secondary"
                  style={{ width: '100%' }}
                >
                  <Calculator size={15} />
                  <span>{calculatingPreview ? 'Computing Amortization...' : '1. Preview Server Amortization Schedule'}</span>
                </button>
              </div>

              {/* Schedule Preview Section */}
              {previewSchedule && (
                <div style={{ background: 'var(--bg-surface-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 16 }}>
                  {/* Financial Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12, textAlign: 'center' }}>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Net Disbursed</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{formatINR(previewSchedule.netDisbursedAmount)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Interest</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--warning-text)' }}>{formatINR(previewSchedule.totalInterest)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Total Payable</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{formatINR(previewSchedule.totalPayable)}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI Amount</div>
                      <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>{formatINR(previewSchedule.emiAmount)}</div>
                    </div>
                  </div>

                  {/* Schedule Details Summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14, textAlign: 'center' }}>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI Start Date</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{previewSchedule.firstEmiDate}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI Tenure</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{previewSchedule.tenureMonths} Months ({previewSchedule.totalInstallments} EMIs)</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>First EMI Due Date</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{previewSchedule.schedule[0]?.dueDate || previewSchedule.firstEmiDate}</div>
                    </div>
                    <div style={{ background: '#ffffff', padding: 10, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Last EMI Due Date</div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{previewSchedule.maturityDate}</div>
                    </div>
                  </div>

                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table className="crm-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Due Date</th>
                          <th>Principal</th>
                          <th>Interest</th>
                          <th>Total Installment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewSchedule.schedule.map((row: any) => (
                          <tr key={row.installmentNumber}>
                            <td className="mono">{row.installmentNumber}</td>
                            <td className="mono">{row.dueDate}</td>
                            <td className="mono">{formatINR(row.principalComponent)}</td>
                            <td className="mono">{formatINR(row.interestComponent)}</td>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--success-text)' }}>
                              {formatINR(row.expectedAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setShowOriginationModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={bookingLoan || !previewSchedule} className="btn btn-primary">
                  {bookingLoan ? 'Booking Loan...' : '2. Disburse Loan & Book Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Loan Schedule & Ledger View */}
      {selectedLoanDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '100%', maxWidth: 800, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Loan Account: {selectedLoanDetail.loan.loanAccountNo || (selectedLoanDetail.loan as any).loan_account_no}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Borrower: {selectedLoanDetail.loan.customerName || (selectedLoanDetail.loan as any).customer_name} • {selectedLoanDetail.loan.areaRoute || (selectedLoanDetail.loan as any).area_route}</p>
              </div>
              <button onClick={() => setSelectedLoanDetail(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Recovery Case Agent Assignment Banner */}
            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 16px',
                marginBottom: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: (selectedLoanDetail.loan.assignedAgentName || (selectedLoanDetail.loan as any).assigned_agent_name)
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'rgba(156, 163, 175, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: (selectedLoanDetail.loan.assignedAgentName || (selectedLoanDetail.loan as any).assigned_agent_name)
                      ? 'var(--success)'
                      : 'var(--text-muted)',
                  }}
                >
                  <UserCheck size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Collection Recovery Agent
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {(selectedLoanDetail.loan.assignedAgentName || (selectedLoanDetail.loan as any).assigned_agent_name) ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{selectedLoanDetail.loan.assignedAgentName || (selectedLoanDetail.loan as any).assigned_agent_name}</span>
                        {(selectedLoanDetail.loan.assignedAgentPhone || (selectedLoanDetail.loan as any).assigned_agent_phone) && (
                          <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-secondary)' }}>
                            • {selectedLoanDetail.loan.assignedAgentPhone || (selectedLoanDetail.loan as any).assigned_agent_phone}
                          </span>
                        )}
                        {(selectedLoanDetail.loan.assignedAt || (selectedLoanDetail.loan as any).assigned_at) && (
                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                            (since {formatDateDDMMYYYY(selectedLoanDetail.loan.assignedAt || (selectedLoanDetail.loan as any).assigned_at)})
                          </span>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontWeight: 500 }}>
                        Unassigned (No agent allocated for field recovery)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleOpenAssignmentHistory(selectedLoanDetail.loan)}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  title="View assignment history audit"
                >
                  <History size={13} />
                  <span>History</span>
                </button>
                {canManageAssignment && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleOpenAssignModal(selectedLoanDetail.loan)}
                      className="btn btn-primary btn-sm"
                    >
                      {(selectedLoanDetail.loan.assignedAgentId || (selectedLoanDetail.loan as any).assigned_agent_id)
                        ? 'Reassign Agent'
                        : 'Assign Agent'}
                    </button>
                    {(selectedLoanDetail.loan.assignedAgentId || (selectedLoanDetail.loan as any).assigned_agent_id) && (
                      <button
                        type="button"
                        onClick={() => handleUnassignLoan(selectedLoanDetail.loan.id)}
                        className="btn btn-danger btn-sm"
                      >
                        Unassign
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Tab Switcher */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setLoanModalTab('schedule')}
                  className={`btn btn-sm ${loanModalTab === 'schedule' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Amortization Schedule ({selectedLoanDetail.installments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLoanModalTab('payments')}
                  className={`btn btn-sm ${loanModalTab === 'payments' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  Payment History ({selectedLoanDetail.payments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLoanModalTab('portal')}
                  className={`btn btn-sm ${loanModalTab === 'portal' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <LinkIcon size={13} />
                  <span>Customer Portal Link</span>
                </button>
              </div>

              {(currentUser?.role === UserRole.SUPER_ADMIN ||
                currentUser?.role === UserRole.ADMIN ||
                (currentUser?.role === UserRole.DEALER &&
                  (selectedLoanDetail.loan.dealerId ?? selectedLoanDetail.loan.dealer_id) === currentUser.dealerId)) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedInstallmentForPayment(null);
                    setShowRecordPaymentModal(true);
                  }}
                  className="btn btn-sm btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <CreditCard size={13} />
                  <span>+ Record Payment</span>
                </button>
              )}
            </div>

            {loanModalTab === 'schedule' ? (
              <div className="table-container" style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Inst #</th>
                      <th>Due Date</th>
                      <th>Expected</th>
                      <th>Penalty</th>
                      <th>Paid</th>
                      <th>Total Due</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLoanDetail.installments.map((inst) => {
                      const instNumber = inst.installmentNumber ?? inst.installment_number;
                      const dueDate = inst.dueDate || inst.due_date ? formatDateDDMMYYYY(inst.dueDate || inst.due_date) : '-';
                      const expectedAmount = Number(inst.expectedAmount ?? inst.expected_amount ?? 0);
                      const penaltyAmount = Number(inst.penaltyAmount ?? inst.penalty_amount ?? 0);
                      const paidAmount = Number(inst.paidAmount ?? inst.paid_amount ?? 0);
                      const remainingAmount = Number(inst.remainingAmount ?? inst.remaining_amount ?? 0);
                      const daysOverdue = Number(inst.daysOverdue ?? inst.days_overdue ?? 0);
                      const totalDue = remainingAmount + penaltyAmount;
                      const isOverdue = inst.status === 'OVERDUE' || daysOverdue > 0;
                      const canAddPenaltyRole =
                        currentUser?.role === UserRole.SUPER_ADMIN ||
                        currentUser?.role === UserRole.ADMIN ||
                        (currentUser?.role === UserRole.DEALER &&
                          (selectedLoanDetail.loan.dealerId ?? selectedLoanDetail.loan.dealer_id) === currentUser.dealerId);

                      return (
                        <tr key={inst.id}>
                          <td className="mono">{instNumber}</td>
                          <td className="mono">{dueDate}</td>
                          <td className="mono">{formatINR(expectedAmount)}</td>
                          <td
                            className="mono"
                            style={{
                              color: penaltyAmount > 0 ? 'var(--danger-text)' : 'inherit',
                              fontWeight: penaltyAmount > 0 ? 700 : 400,
                            }}
                          >
                            {formatINR(penaltyAmount)}
                          </td>
                          <td className="mono" style={{ color: 'var(--success-text)' }}>
                            {formatINR(paidAmount)}
                          </td>
                          <td
                            className="mono"
                            style={{
                              color: totalDue > 0 ? 'var(--danger-text)' : 'inherit',
                              fontWeight: 600,
                            }}
                          >
                            {formatINR(totalDue)}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                inst.status === 'PAID'
                                  ? 'badge-paid'
                                  : inst.status === 'DUE_TODAY'
                                  ? 'badge-due-today'
                                  : inst.status === 'OVERDUE'
                                  ? 'badge-overdue'
                                  : 'badge-upcoming'
                              }`}
                            >
                              {inst.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              {inst.status !== 'PAID' && remainingAmount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedInstallmentForPayment(inst);
                                    setShowRecordPaymentModal(true);
                                  }}
                                  className="btn btn-xs btn-primary"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  title="Record payment for this installment"
                                >
                                  Collect
                                </button>
                              )}

                              {isOverdue && inst.status !== 'PAID' && remainingAmount > 0 && canAddPenaltyRole && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAddPenalty(inst)}
                                  disabled={currentUser?.role === UserRole.DEALER && !allowDealerPenalty}
                                  className="btn btn-xs btn-outline-danger"
                                  title={
                                    currentUser?.role === UserRole.DEALER && !allowDealerPenalty
                                      ? 'Dealer penalty creation is disabled by Super Admin'
                                      : 'Add Late Payment Penalty'
                                  }
                                  style={{
                                    fontSize: 11,
                                    padding: '2px 8px',
                                    opacity: currentUser?.role === UserRole.DEALER && !allowDealerPenalty ? 0.5 : 1,
                                    cursor:
                                      currentUser?.role === UserRole.DEALER && !allowDealerPenalty
                                        ? 'not-allowed'
                                        : 'pointer',
                                  }}
                                >
                                  + Penalty
                                </button>
                              )}

                              {penaltyAmount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenPenaltyHistory(inst)}
                                  className="btn btn-xs btn-secondary"
                                  style={{ fontSize: 11, padding: '2px 8px' }}
                                  title="View Penalty History & Adjustments"
                                >
                                  History
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : loanModalTab === 'payments' ? (
              <div className="table-container" style={{ maxHeight: 340, overflowY: 'auto' }}>
                {selectedLoanDetail.payments.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-muted)', fontSize: 13 }}>
                    No payments recorded towards this loan account yet.
                  </div>
                ) : (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Receipt No</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Source</th>
                        <th>Mode</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLoanDetail.payments.map((p) => {
                        const isReversed = p.status === 'REVERSED' || Boolean(p.is_reversal || p.isReversal);
                        const source = p.collectionSource || p.collection_source || 'DIRECT_CUSTOMER';
                        return (
                          <tr key={p.id}>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                              {p.receiptNumber || p.receipt_number}
                            </td>
                            <td className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {formatDateDDMMYYYY(p.paymentTimestamp || p.payment_timestamp)}
                            </td>
                            <td
                              className="mono"
                              style={{
                                fontWeight: 700,
                                color: isReversed ? 'var(--text-muted)' : 'var(--success-text)',
                                textDecoration: isReversed ? 'line-through' : 'none',
                              }}
                            >
                              {formatINR(p.amount)}
                            </td>
                            <td>
                              {source === 'DEALER' ? (
                                <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Store size={10} />
                                  <span>DEALER</span>
                                </span>
                              ) : source === 'RECOVERY_AGENT' ? (
                                <span className="badge badge-due-today" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <UserCheck size={10} />
                                  <span>RECOVERY AGENT</span>
                                </span>
                              ) : (
                                <span className="badge badge-paid" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <Building2 size={10} />
                                  <span>DIRECT</span>
                                </span>
                              )}
                            </td>
                            <td>
                              <span className="badge badge-upcoming">{p.paymentMode || p.payment_mode}</span>
                            </td>
                            <td>
                              <span className={`badge ${isReversed ? 'badge-overdue' : 'badge-paid'}`}>
                                {isReversed ? 'REVERSED' : 'SUCCESS'}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={async () => {
                                  try {
                                    const r = await ApiClient.getReceipt(p.id);
                                    setSelectedReceipt(r);
                                  } catch (e: any) {
                                    alert(e.message || 'Failed to fetch receipt');
                                  }
                                }}
                                className="btn btn-secondary btn-sm"
                                title="View Receipt"
                              >
                                <Receipt size={12} />
                                <span>Receipt</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              <PortalLinkManager
                loanId={selectedLoanDetail.loan.id}
                loanAccountNo={selectedLoanDetail.loan.loanAccountNo || (selectedLoanDetail.loan as any).loan_account_no}
                customerName={selectedLoanDetail.loan.customerName || (selectedLoanDetail.loan as any).customer_name}
                primaryPhone={selectedLoanDetail.loan.primaryPhone || (selectedLoanDetail.loan as any).primary_phone || (selectedLoanDetail.loan as any).phone}
                userRole={currentUser?.role}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setSelectedLoanDetail(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loan Receipt Viewer Modal */}
      {selectedReceipt && (
        <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.7)', zIndex: 1100 }}>
          <div
            className="modal-content"
            style={{
              width: '100%',
              maxWidth: 440,
              padding: 24,
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 8,
            }}
          >
            <div style={{ textAlign: 'center', borderBottom: '2px solid #e2e8f0', paddingBottom: 12, marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', letterSpacing: '0.5px' }}>ALPHA MOBILE GALLERY</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#b8532f', marginTop: 1 }}>SHUBH PVT LTD</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>OFFICIAL PAYMENT RECEIPT</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>
                {selectedReceipt.receiptNumber}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Borrower:</span>
                <strong>{selectedReceipt.customer?.name} ({selectedReceipt.customer?.code})</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Loan Account:</span>
                <strong className="mono">{selectedReceipt.loan?.accountNo}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Collection Source:</span>
                <strong style={{ color: '#9a3412' }}>{selectedReceipt.collectionSource}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Payment Mode:</span>
                <span>{selectedReceipt.paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed #cbd5e1', paddingTop: 8, marginTop: 4 }}>
                <span style={{ fontWeight: 800 }}>Amount Paid:</span>
                <strong className="mono" style={{ fontSize: 16, color: '#15803d' }}>
                  {formatINR(selectedReceipt.amount)}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Remaining Loan:</span>
                <span className="mono font-bold">{formatINR(selectedReceipt.loan?.remainingOutstanding || 0)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => window.print()} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                <Printer size={13} />
                <span>Print</span>
              </button>
              <button onClick={() => setSelectedReceipt(null)} className="btn btn-secondary btn-sm" style={{ flex: 1 }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ADD LATE PAYMENT PENALTY MODAL ───────────────────────── */}
      {penaltyModalEmi && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Add Late Payment Penalty</h3>
              <button type="button" onClick={() => setPenaltyModalEmi(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 13,
                background: 'var(--bg-app)',
                padding: 14,
                borderRadius: 'var(--radius-md)',
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>EMI:</span>
                <span style={{ fontWeight: 700 }}>#{penaltyModalEmi.installmentNumber ?? penaltyModalEmi.installment_number}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Original EMI:</span>
                <span style={{ fontWeight: 600 }}>{formatINR(penaltyModalEmi.expectedAmount ?? penaltyModalEmi.expected_amount ?? 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Outstanding:</span>
                <span style={{ fontWeight: 700, color: 'var(--danger-text)' }}>
                  {formatINR(penaltyModalEmi.remainingAmount ?? penaltyModalEmi.remaining_amount ?? 0)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Days Overdue:</span>
                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>
                  {(penaltyModalEmi.daysOverdue ?? penaltyModalEmi.days_overdue) || Math.max(1, Math.round((new Date().getTime() - new Date(penaltyModalEmi.dueDate || penaltyModalEmi.due_date).getTime()) / (1000 * 3600 * 24)))} days
                </span>
              </div>
            </div>

            {penaltyError && (
              <div
                style={{
                  color: 'var(--danger)',
                  background: 'var(--danger-bg)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                {penaltyError}
              </div>
            )}

            {penaltySuccess && (
              <div
                style={{
                  color: 'var(--success)',
                  background: 'rgba(34, 197, 94, 0.1)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                {penaltySuccess}
              </div>
            )}

            <form onSubmit={handleSubmitPenalty} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Penalty Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  required
                  className="form-input"
                  value={penaltyAmount}
                  onChange={(e) => setPenaltyAmount(e.target.value)}
                  onBlur={(e) => setPenaltyAmount(normalizeNumericLeadingZeros(e.target.value))}
                  placeholder="e.g. 500"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                  Reason *
                </label>
                <input
                  type="text"
                  required
                  className="form-input"
                  value={penaltyReason}
                  onChange={(e) => setPenaltyReason(e.target.value)}
                  placeholder="e.g. Late payment beyond grace period"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setPenaltyModalEmi(null)}
                  className="btn btn-secondary"
                  disabled={submittingPenalty}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingPenalty}
                >
                  {submittingPenalty ? 'Adding...' : 'Add Penalty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── PENALTY HISTORY & WAIVER MODAL ───────────────────────── */}
      {historyModalEmi && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                  Penalty History — EMI #{historyModalEmi.installmentNumber ?? historyModalEmi.installment_number}
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Total Active Penalties: {formatINR(penaltyHistory?.activePenaltyTotal ?? historyModalEmi.penaltyAmount ?? historyModalEmi.penalty_amount ?? 0)}
                </span>
              </div>
              <button type="button" onClick={() => setHistoryModalEmi(null)} className="btn-icon">
                <X size={18} />
              </button>
            </div>

            {loadingHistory ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading penalty records...
              </div>
            ) : historyError ? (
              <div style={{ color: 'var(--danger)', padding: 16 }}>{historyError}</div>
            ) : !penaltyHistory?.penalties || penaltyHistory.penalties.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-secondary)' }}>
                No penalties recorded for this installment.
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table className="crm-table" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Paid</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Created By</th>
                      <th>Date</th>
                      {(currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN) && (
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {penaltyHistory.penalties.map((pen: any) => (
                      <tr key={pen.id}>
                        <td className="mono" style={{ fontWeight: 700 }}>{formatINR(pen.amount)}</td>
                        <td className="mono" style={{ color: 'var(--success-text)' }}>{formatINR(pen.paidAmount)}</td>
                        <td>
                          <span
                            className={`badge ${
                              pen.status === 'PAID'
                                ? 'badge-paid'
                                : pen.status === 'ACTIVE'
                                ? 'badge-overdue'
                                : 'badge-upcoming'
                            }`}
                          >
                            {pen.status}
                          </span>
                        </td>
                        <td>{pen.reason}</td>
                        <td>{pen.createdByName || pen.createdBy || 'Staff'}</td>
                        <td className="mono">{pen.createdAt?.slice(0, 10)}</td>
                        {(currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN) && (
                          <td style={{ textAlign: 'right' }}>
                            {pen.status === 'ACTIVE' && (
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() => handleReverseOrWaive(pen.id, 'WAIVE')}
                                  className="btn btn-xs btn-outline-warning"
                                  title="Waive penalty"
                                >
                                  Waive
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReverseOrWaive(pen.id, 'REVERSE')}
                                  className="btn btn-xs btn-outline-danger"
                                  title="Reverse penalty"
                                >
                                  Reverse
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setHistoryModalEmi(null)}
                className="btn btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Super Admin Rejection Reason Modal */}
      {rejectingLoan && (
        <div className="modal-overlay" style={{ zIndex: 3100 }} onClick={() => setRejectingLoan(null)}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={20} color="var(--danger)" />
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Reject Loan Application</h3>
              </div>
              <button onClick={() => setRejectingLoan(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Rejecting loan <strong className="mono">{rejectingLoan.loanAccountNo || rejectingLoan.loan_account_no}</strong> for customer <strong>{rejectingLoan.customerName || rejectingLoan.customer_name}</strong>.
              Please provide the mandatory rejection reason for regulatory compliance and partner store visibility.
            </p>

            {decisionError && (
              <div style={{ padding: 10, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 6, color: 'var(--danger-text)', fontSize: 12, marginBottom: 14 }}>
                {decisionError}
              </div>
            )}

            <form onSubmit={handleConfirmReject} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  Rejection Reason <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Incomplete KYC documentation, insufficient down payment, or customer credit risk"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setRejectingLoan(null)} className="btn btn-secondary btn-sm" disabled={submittingDecision}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-danger btn-sm" disabled={submittingDecision || !rejectionReason.trim()}>
                  {submittingDecision ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ─── RECOVERY CASE AGENT ASSIGNMENT MODAL ────────────────── */}
      {assigningLoan && (
        <div className="modal-overlay" style={{ zIndex: 3200 }} onClick={() => setAssigningLoan(null)}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 520, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <UserCheck size={20} color="var(--primary)" />
                <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  {(assigningLoan.assignedAgentId || assigningLoan.assigned_agent_id)
                    ? 'Reassign Recovery Agent'
                    : 'Assign Recovery Agent'}
                </h3>
              </div>
              <button onClick={() => setAssigningLoan(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Case Details Card */}
            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                marginBottom: 16,
                fontSize: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 8,
              }}
            >
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>{' '}
                <strong className="mono">{assigningLoan.loanAccountNo || assigningLoan.loan_account_no}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Customer:</span>{' '}
                <strong>{assigningLoan.customerName || (assigningLoan as any).customer_name || assigningLoan.customer?.fullName}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Outstanding Balance:</span>{' '}
                <strong className="mono" style={{ color: 'var(--danger-text)' }}>
                  {formatINR(assigningLoan.outstandingBalance || assigningLoan.outstanding_balance || 0)}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-secondary)' }}>Current Agent:</span>{' '}
                <strong>
                  {assigningLoan.assignedAgentName || (assigningLoan as any).assigned_agent_name || (
                    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unassigned</span>
                  )}
                </strong>
              </div>
            </div>

            {assignmentError && (
              <div style={{ padding: 10, background: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 6, color: 'var(--danger-text)', fontSize: 12, marginBottom: 14 }}>
                {assignmentError}
              </div>
            )}

            {assignmentSuccess && (
              <div style={{ padding: 10, background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 6, color: 'var(--success-text)', fontSize: 12, marginBottom: 14 }}>
                {assignmentSuccess}
              </div>
            )}

            <form onSubmit={handleSubmitAssignment} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Select Active Collection Agent <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  className="form-input"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  required
                >
                  <option value="">-- Choose active agent --</option>
                  {activeAgentsList
                    .filter((a) => (a.status || (a as any).status) === 'ACTIVE')
                    .map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.fullName || agent.full_name || agent.name} ({agent.phone || agent.loginId || agent.login_id})
                      </option>
                    ))}
                </select>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Only active field collection agents can receive recovery assignments.
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  Assignment Notes (Optional)
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="e.g. Priority recovery: customer reachable in evening after 6 PM"
                  value={assignmentNotes}
                  onChange={(e) => setAssignmentNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setAssigningLoan(null)}
                  className="btn btn-secondary btn-sm"
                  disabled={submittingAssignment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={submittingAssignment || !selectedAgentId}
                >
                  {submittingAssignment
                    ? 'Assigning...'
                    : (assigningLoan.assignedAgentId || assigningLoan.assigned_agent_id)
                    ? 'Confirm Reassignment'
                    : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── RECOVERY ASSIGNMENT HISTORY MODAL ────────────────────── */}
      {historyLoan && (
        <div className="modal-overlay" style={{ zIndex: 3200 }} onClick={() => setHistoryLoan(null)}>
          <div className="modal-content" style={{ width: '100%', maxWidth: 700, padding: 24 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>
                  Assignment History Audit
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Loan: <strong className="mono">{historyLoan.loanAccountNo || historyLoan.loan_account_no}</strong>
                </p>
              </div>
              <button onClick={() => setHistoryLoan(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {loadingAssignmentHistory ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-secondary)' }}>
                Loading assignment audit history...
              </div>
            ) : assignmentHistoryList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                No historical assignments recorded for this loan.
              </div>
            ) : (
              <div className="table-container" style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Contact Phone</th>
                      <th>Assigned By</th>
                      <th>Effective From</th>
                      <th>Effective To</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignmentHistoryList.map((hist) => (
                      <tr key={hist.id}>
                        <td style={{ fontWeight: 600 }}>{hist.agentName}</td>
                        <td className="mono">{hist.agentPhone}</td>
                        <td>{hist.assignedByName}</td>
                        <td className="mono">{hist.effectiveFrom}</td>
                        <td className="mono">{hist.effectiveTo || 'Present'}</td>
                        <td>
                          <span className={`badge ${hist.isActive ? 'badge-paid' : 'badge-upcoming'}`}>
                            {hist.isActive ? 'ACTIVE' : 'HISTORICAL'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" onClick={() => setHistoryLoan(null)} className="btn btn-secondary btn-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecordPaymentModal && (
        <RecordPaymentModal
          isOpen={showRecordPaymentModal}
          onClose={() => {
            setShowRecordPaymentModal(false);
            setSelectedInstallmentForPayment(null);
          }}
          onSuccess={() => {
            if (selectedLoanDetail) {
              handleViewLoan(selectedLoanDetail.loan.id, 'payments');
            }
            ApiClient.listLoans().then(setLoans).catch(console.error);
          }}
          user={currentUser}
          preselectedLoan={selectedLoanDetail?.loan}
          preselectedInstallment={selectedInstallmentForPayment}
        />
      )}
    </div>
  );
};
