import React, { useState, useEffect } from 'react';
import {
  ILoan,
  CollectionSource,
  PaymentMode,
  formatINR,
  formatDateDDMMYYYY,
  normalizeNumericLeadingZeros,
  getBusinessDate,
  UserRole,
  IUser,
  IPaymentPreview,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  X,
  CreditCard,
  Building2,
  Store,
  UserCheck,
  CheckCircle2,
  Printer,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (receipt: any) => void;
  user?: IUser;
  preselectedLoan?: any;
  preselectedInstallment?: any;
  preselectedCustomerId?: string;
  isDealerContext?: boolean;
  dealerId?: string;
  dealerStoreName?: string;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  user,
  preselectedLoan,
  preselectedInstallment,
  preselectedCustomerId,
  isDealerContext = false,
  dealerId,
  dealerStoreName,
}) => {
  const isDealer = isDealerContext || user?.role === UserRole.DEALER;
  const effectiveDealerId = dealerId || user?.dealerId;

  // Form State
  const [activeLoans, setActiveLoans] = useState<any[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string>(preselectedLoan?.id || '');
  const [selectedLoan, setSelectedLoan] = useState<any | null>(preselectedLoan || null);

  const [installments, setInstallments] = useState<any[]>([]);
  const [selectedInstallmentId, setSelectedInstallmentId] = useState<string>(
    preselectedInstallment?.id || ''
  );
  const [selectedInstallment, setSelectedInstallment] = useState<any | null>(
    preselectedInstallment || null
  );

  const [emiDue, setEmiDue] = useState<number>(0);
  const [penaltyDue, setPenaltyDue] = useState<number>(0);
  const [totalDue, setTotalDue] = useState<number>(0);

  const [paymentAmountStr, setPaymentAmountStr] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(PaymentMode.CASH);
  const [collectionSource, setCollectionSource] = useState<CollectionSource>(
    isDealer ? CollectionSource.DEALER : CollectionSource.DIRECT_CUSTOMER
  );
  const [selectedDealerId, setSelectedDealerId] = useState<string>(effectiveDealerId || '');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [dealersList, setDealersList] = useState<any[]>([]);
  const [agentsList, setAgentsList] = useState<any[]>([]);

  const [paymentDateStr, setPaymentDateStr] = useState<string>(() => {
    return getBusinessDate(undefined, 'Asia/Kolkata');
  });
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const [paymentPreview, setPaymentPreview] = useState<IPaymentPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const activeRequestIdRef = React.useRef(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);

  // Reset state when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setPaymentPreview(null);
      setLoadingPreview(false);
      setShowConfirmation(false);
      setError(null);
      setReceipt(null);
      setPaymentAmountStr('');
    }
  }, [isOpen]);

  // Initialize or fetch loans if not preselected
  useEffect(() => {
    if (!isOpen) return;

    if (preselectedLoan) {
      setSelectedLoan(preselectedLoan);
      setSelectedLoanId(preselectedLoan.id);
      loadLoanDetails(preselectedLoan.id);
    } else {
      loadActiveLoans();
    }

    // Load dealers and agents for admin selection if not dealer
    if (!isDealer) {
      ApiClient.getDealers(undefined, 'ACTIVE')
        .then(setDealersList)
        .catch(() => []);
      ApiClient.getUsers('COLLECTION_AGENT', 'ACTIVE')
        .then(setAgentsList)
        .catch(() => []);
    }
  }, [isOpen, preselectedLoan, isDealer, effectiveDealerId]);

  const loadActiveLoans = async () => {
    setLoadingLoans(true);
    try {
      if (isDealer) {
        const dashboard = await ApiClient.getDealerDashboard();
        const active = (dashboard.recentLoans || []).filter(
          (l: any) => l.status === 'ACTIVE' || Number(l.outstandingBalance) > 0
        );
        setActiveLoans(active);
        if (active.length > 0 && !selectedLoanId) {
          setSelectedLoanId(active[0].id);
          setSelectedLoan(active[0]);
          loadLoanDetails(active[0].id);
        }
      } else {
        const loansRes = await ApiClient.listLoans({ status: 'ACTIVE' }, 1, 50);
        const loansList = Array.isArray(loansRes) ? loansRes : loansRes?.items || [];
        setActiveLoans(loansList);
        if (loansList.length > 0 && !selectedLoanId) {
          setSelectedLoanId(loansList[0].id);
          setSelectedLoan(loansList[0]);
          loadLoanDetails(loansList[0].id);
        }
      }
    } catch (err: any) {
      console.error('Failed to load active loans', err);
    } finally {
      setLoadingLoans(false);
    }
  };

  const fetchPreview = async (loanId: string, installmentId?: string, amount?: string | number) => {
    if (!loanId) return;
    const reqId = ++activeRequestIdRef.current;
    setLoadingPreview(true);
    try {
      const res = await ApiClient.getPaymentPreview({
        loanId,
        installmentId: installmentId || undefined,
        amount: amount !== undefined && amount !== null && String(amount).trim() !== '' ? amount : undefined,
      });
      if (reqId !== activeRequestIdRef.current) return;
      const preview: IPaymentPreview = res.data || res;
      setPaymentPreview(preview);
      setEmiDue(preview.remainingAmount);
      setPenaltyDue(preview.penaltyAmount);
      setTotalDue(preview.totalDue);
      if (amount === undefined || amount === null || String(amount).trim() === '') {
        setPaymentAmountStr(String(preview.totalDue));
      }
      return preview;
    } catch (err: any) {
      if (reqId === activeRequestIdRef.current) {
        console.error('Failed to fetch payment preview', err);
      }
      return null;
    } finally {
      if (reqId === activeRequestIdRef.current) {
        setLoadingPreview(false);
      }
    }
  };

  const loadLoanDetails = async (loanId: string) => {
    try {
      const detail: any = await ApiClient.getLoanById(loanId);
      const loanObj = detail?.loan || detail;
      setSelectedLoan(loanObj);

      const insts = detail.installments || [];
      setInstallments(insts);

      // Find unpaid / overdue installment or use preselected
      let targetInst = preselectedInstallment;
      if (!targetInst) {
        targetInst = insts.find(
          (i: any) =>
            i.status === 'OVERDUE' ||
            i.status === 'DUE_TODAY' ||
            i.status === 'PENDING' ||
            Number(i.remainingAmount || i.remaining_amount || 0) > 0
        ) || insts[0];
      }

      if (targetInst) {
        setSelectedInstallmentId(targetInst.id);
        setSelectedInstallment(targetInst);
        computeAmounts(targetInst, insts);
        fetchPreview(loanId, targetInst.id);
      } else {
        // Fallback to loan amounts
        const baseEmi = Number(loanObj.emiAmount || loanObj.emi_amount || 0);
        setEmiDue(baseEmi);
        setPenaltyDue(0);
        setTotalDue(baseEmi);
        setPaymentAmountStr(String(baseEmi));
        fetchPreview(loanId);
      }
    } catch (err: any) {
      console.error('Failed to load loan details', err);
    }
  };

  const computeAmounts = (inst: any, _allInsts: any[]) => {
    const emi = Number(inst.remainingAmount ?? inst.remaining_amount ?? inst.expectedAmount ?? inst.expected_amount ?? 0);
    const penalty = Number(inst.penaltyAmount ?? inst.penalty_amount ?? 0);
    const sum = emi + penalty;

    setEmiDue(emi);
    setPenaltyDue(penalty);
    setTotalDue(sum);
    setPaymentAmountStr(String(sum > 0 ? sum : Number(selectedLoan?.emiAmount || 0)));
  };

  const handleLoanChange = (loanId: string) => {
    setSelectedLoanId(loanId);
    const l = activeLoans.find((item) => item.id === loanId);
    if (l) {
      setSelectedLoan(l);
      loadLoanDetails(loanId);
    }
  };

  const handleInstallmentChange = (instId: string) => {
    setSelectedInstallmentId(instId);
    const inst = installments.find((i) => i.id === instId);
    if (inst) {
      setSelectedInstallment(inst);
      computeAmounts(inst, installments);
      fetchPreview(selectedLoanId, instId, paymentAmountStr);
    }
  };

  const handleAmountChange = (val: string) => {
    // Only accept numeric input (digits and at most one decimal point), prevent negative values
    if (val === '' || /^\d*\.?\d*$/.test(val)) {
      setPaymentAmountStr(val);
      if (selectedLoanId && val !== '' && !isNaN(Number(val))) {
        fetchPreview(selectedLoanId, selectedInstallmentId, val);
      }
    }
  };

  const handleAmountBlur = () => {
    if (paymentAmountStr) {
      const normalized = normalizeNumericLeadingZeros(paymentAmountStr);
      setPaymentAmountStr(normalized);
      if (selectedLoanId && !isNaN(Number(normalized))) {
        fetchPreview(selectedLoanId, selectedInstallmentId, normalized);
      }
    }
  };

  const handleReviewOrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const amountNum = parseFloat(paymentAmountStr);
    if (!amountNum || amountNum <= 0) {
      setError('Please enter a valid payment amount greater than ₹0');
      return;
    }

    if (!selectedLoan) {
      setError('Please select an active loan account');
      return;
    }

    const customerId =
      selectedLoan.customerId ||
      selectedLoan.customer_id ||
      preselectedCustomerId;

    if (!customerId) {
      setError('Customer record could not be resolved for this loan');
      return;
    }

    if (collectionSource === CollectionSource.DEALER && !effectiveDealerId && !selectedDealerId) {
      setError('Please select a partner store');
      return;
    }

    if (collectionSource === CollectionSource.RECOVERY_AGENT && !selectedAgentId) {
      setError('Please select a recovery agent');
      return;
    }

    // Refresh preview to ensure latest authoritative numbers before showing confirmation
    const updated = await fetchPreview(selectedLoan.id, selectedInstallmentId, amountNum);
    if (!updated && !paymentPreview) {
      setError('Failed to calculate authoritative payment preview. Please try again.');
      return;
    }

    setShowConfirmation(true);
  };

  const handleFinalPaymentSubmit = async () => {
    setError(null);
    const amountNum = parseFloat(paymentAmountStr);
    if (!amountNum || amountNum <= 0 || !selectedLoan) {
      setError('Please enter a valid payment amount greater than ₹0');
      setShowConfirmation(false);
      return;
    }

    const customerId =
      selectedLoan.customerId ||
      selectedLoan.customer_id ||
      preselectedCustomerId;

    setSubmitting(true);
    try {
      const idempotencyKey = `${isDealer ? 'DEALER' : 'ADMIN'}_${selectedLoan.id}_${Date.now()}`;
      const payload: any = {
        loanId: selectedLoan.id,
        emiId: selectedInstallmentId || undefined,
        customerId,
        amount: amountNum,
        paymentMode,
        collectionSource,
        dealerId: collectionSource === CollectionSource.DEALER ? (effectiveDealerId || selectedDealerId) : undefined,
        agentId: collectionSource === CollectionSource.RECOVERY_AGENT ? selectedAgentId : undefined,
        referenceNumber: referenceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        idempotencyKey,
      };

      const res = await ApiClient.recordPayment(payload);
      setReceipt(res);
      setShowConfirmation(false);
      if (onSuccess) {
        onSuccess(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
      setShowConfirmation(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 1100 }}>
      <div
        className="modal-content"
        style={{
          width: '100%',
          maxWidth: receipt ? 500 : 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
        }}
      >
        {receipt ? (
          /* Official Payment Receipt Card */
          <div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--success-subtle, #dcfce7)',
                  color: 'var(--success, #16a34a)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px',
                }}
              >
                <CheckCircle2 size={32} />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                Payment Recorded Successfully
              </h3>
              <div className="mono font-bold" style={{ color: 'var(--primary)', fontSize: 14, marginTop: 4 }}>
                {receipt.receiptNumber}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Date: {formatDateDDMMYYYY(receipt.paymentTimestamp || new Date().toISOString())}
              </div>
            </div>

            {(() => {
              const receiptAllocations = receipt.allocatedInstallments || receipt.allocations || [];
              const receiptPenaltyAllocated = receiptAllocations.reduce(
                (sum: number, a: any) => sum + (Number(a.allocatedToPenalty ?? a.penaltyComponent ?? 0) || 0),
                0
              );
              const receiptPIAllocated = receiptAllocations.reduce(
                (sum: number, a: any) =>
                  sum +
                  (Number(a.allocatedToPrincipal ?? a.principalComponent ?? 0) +
                    Number(a.allocatedToInterest ?? a.interestComponent ?? 0)),
                0
              );
              const collectedAmt = Number(receipt.amountCollected || receipt.amount || 0);

              return (
                <div
                  style={{
                    background: 'var(--bg-surface-secondary)',
                    borderRadius: 'var(--radius-md)',
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    fontSize: 13,
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Borrower:</span>
                    <strong>{receipt.customer?.name || selectedLoan?.customerName}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>
                    <span className="mono font-bold">{receipt.loan?.accountNo || selectedLoan?.loanAccountNo}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Amount Collected:</span>
                    <strong className="mono font-bold" style={{ color: 'var(--success)', fontSize: 15 }}>
                      {formatINR(collectedAmt)}
                    </strong>
                  </div>

                  {receiptPenaltyAllocated > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--danger-text)' }}>Late Penalty Satisfied:</span>
                      <strong className="mono" style={{ color: 'var(--danger-text)' }}>
                        {formatINR(receiptPenaltyAllocated)}
                      </strong>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Principal & Interest Satisfied:</span>
                    <strong className="mono">
                      {formatINR(
                        receiptPIAllocated > 0 ? receiptPIAllocated : Math.max(0, collectedAmt - receiptPenaltyAllocated)
                      )}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Payment Mode:</span>
                    <span className="badge badge-route">{receipt.paymentMode}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Collection Source:</span>
                    <span className="badge badge-terracotta">
                      {receipt.collectionSource === 'DEALER'
                        ? 'DEALER'
                        : receipt.collectionSource === 'RECOVERY_AGENT'
                        ? 'RECOVERY AGENT'
                        : 'DIRECT'}
                    </span>
                  </div>
                  {receipt.remainingLoanOutstanding !== undefined && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        borderTop: '1px solid var(--border-subtle)',
                        paddingTop: 8,
                        marginTop: 4,
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>Remaining Loan Balance:</span>
                      <strong className="mono" style={{ color: 'var(--warning-text, #d97706)' }}>
                        {formatINR(receipt.remainingLoanOutstanding)}
                      </strong>
                    </div>
                  )}
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => window.print()}
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <Printer size={15} />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                Done
              </button>
            </div>
          </div>
        ) : showConfirmation ? (
          /* Pre-Submission Review & Confirmation Screen */
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: 14,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                }}
              >
                <CheckCircle2 size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Review Payment Collection
                </h3>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Confirm ledger entry breakdown before final recording
                </div>
              </div>
            </div>

            {error && (
              <div
                style={{
                  background: 'var(--danger-subtle, #fee2e2)',
                  border: '1px solid var(--danger, #ef4444)',
                  color: 'var(--danger-text, #b91c1c)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <div
              style={{
                background: 'var(--bg-surface-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                fontSize: 13,
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Borrower:</span>
                <strong>{selectedLoan?.customerName || selectedLoan?.customer_name || paymentPreview?.customerName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Loan Account:</span>
                <span className="mono font-bold">
                  {selectedLoan?.loanAccountNo || selectedLoan?.loan_account_no || paymentPreview?.loanAccountNo}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Target Installment:</span>
                <span className="mono font-bold">
                  {paymentPreview?.installmentNumber
                    ? `EMI #${paymentPreview.installmentNumber}`
                    : selectedInstallment
                    ? `EMI #${selectedInstallment.installmentNumber || selectedInstallment.installment_number}`
                    : 'Active Dues'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Payment Mode:</span>
                <span className="badge badge-route">{paymentMode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Collection Source:</span>
                <span className="badge badge-terracotta">
                  {collectionSource === CollectionSource.DEALER
                    ? 'DEALER'
                    : collectionSource === CollectionSource.RECOVERY_AGENT
                    ? 'RECOVERY AGENT'
                    : 'DIRECT'}
                </span>
              </div>

              <div style={{ borderTop: '1px dashed var(--border-subtle)', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Payment Amount:</span>
                <strong className="mono" style={{ fontSize: 17, color: 'var(--success)', fontWeight: 800 }}>
                  {formatINR(Number(paymentAmountStr) || 0)}
                </strong>
              </div>

              <div
                style={{
                  background: 'var(--bg-surface)',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>1. Late Penalty Satisfied:</span>
                  <strong
                    className="mono"
                    style={{
                      color:
                        (paymentPreview?.allocationPreview?.penaltyAllocated ?? 0) > 0
                          ? 'var(--danger-text)'
                          : 'var(--text-primary)',
                    }}
                  >
                    {formatINR(paymentPreview?.allocationPreview?.penaltyAllocated ?? 0)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>2. Applied to EMI (P&I):</span>
                  <strong className="mono" style={{ color: 'var(--primary)' }}>
                    {formatINR(paymentPreview?.allocationPreview?.principalInterestAllocated ?? 0)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Target EMI New Status:</span>
                  <span className="badge badge-terracotta">
                    {paymentPreview?.allocationPreview?.newEmiStatus ||
                      (Number(paymentAmountStr) >= (paymentPreview?.totalDue ?? totalDue) ? 'PAID' : 'PARTIALLY_PAID')}
                  </span>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: 8,
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>Remaining Loan Outstanding:</span>
                <strong className="mono" style={{ color: 'var(--warning-text, #d97706)' }}>
                  {formatINR(
                    paymentPreview?.allocationPreview?.remainingOutstanding ??
                      selectedLoan?.outstandingBalance ??
                      selectedLoan?.outstanding_balance ??
                      0
                  )}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                className="btn btn-secondary"
                style={{ flex: 1 }}
                disabled={submitting}
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={handleFinalPaymentSubmit}
                className="btn btn-primary"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                disabled={submitting}
              >
                <CheckCircle2 size={16} />
                <span>{submitting ? 'Recording...' : 'Confirm & Record Payment'}</span>
              </button>
            </div>
          </div>
        ) : (
          /* Payment Input Form */
          <div>
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
                paddingBottom: 14,
                marginBottom: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                  }}
                >
                  <CreditCard size={18} />
                </div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    {isDealer ? 'Record Store EMI Payment' : 'Record EMI / Loan Payment'}
                  </h3>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {isDealer
                      ? `Partner Store Collection • ${dealerStoreName || 'Dealer Store'}`
                      : 'Financial Central Payment Ledger • Super Admin / Finance Ops'}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="btn btn-secondary btn-sm"
                style={{ padding: '4px 6px', lineHeight: 1 }}
              >
                <X size={16} />
              </button>
            </div>

            {error && (
              <div
                style={{
                  background: 'var(--danger-subtle, #fee2e2)',
                  border: '1px solid var(--danger, #ef4444)',
                  color: 'var(--danger-text, #b91c1c)',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 12,
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleReviewOrSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Loan Account Selection (if not preselected) */}
              {!preselectedLoan && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Select Active Loan Account <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  {loadingLoans ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
                      Loading eligible store loans...
                    </div>
                  ) : activeLoans.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--danger)', padding: '6px 0' }}>
                      No active loans available for payment recording.
                    </div>
                  ) : (
                    <select
                      className="form-select mono"
                      value={selectedLoanId}
                      onChange={(e) => handleLoanChange(e.target.value)}
                      required
                    >
                      {activeLoans.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.loanAccountNo} — {l.customerName} (Bal: {formatINR(l.outstandingBalance || 0)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Loan Context Overview */}
              {selectedLoan && (
                <div
                  style={{
                    background: 'var(--bg-surface-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    padding: 12,
                    fontSize: 12,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 8,
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Customer: </span>
                    <strong>{selectedLoan.customerName || selectedLoan.customer_name}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Code: </span>
                    <span className="mono">{selectedLoan.customerCode || selectedLoan.customer_code}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Loan Acc: </span>
                    <span className="mono font-bold" style={{ color: 'var(--primary)' }}>
                      {selectedLoan.loanAccountNo || selectedLoan.loan_account_no}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Outstanding: </span>
                    <span className="mono font-bold" style={{ color: 'var(--warning-text, #d97706)' }}>
                      {formatINR(selectedLoan.outstandingBalance || selectedLoan.outstanding_balance || 0)}
                    </span>
                  </div>
                </div>
              )}

              {/* Installment selection if multiple */}
              {installments.length > 1 && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Target Installment
                  </label>
                  <select
                    className="form-select mono"
                    value={selectedInstallmentId}
                    onChange={(e) => handleInstallmentChange(e.target.value)}
                  >
                    {installments.map((inst) => {
                      const num = inst.installmentNumber ?? inst.installment_number;
                      const date = formatDateDDMMYYYY(inst.dueDate ?? inst.due_date);
                      const due = Number(inst.remainingAmount ?? inst.remaining_amount ?? 0);
                      const pen = Number(inst.penaltyAmount ?? inst.penalty_amount ?? 0);
                      return (
                        <option key={inst.id} value={inst.id}>
                          EMI #{num} (Due: {date}) — Due: {formatINR(due + pen)} [{inst.status}]
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Dedicated Late Payment Penalty & Dues Breakdown Box */}
              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 14,
                  background: 'linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-surface-secondary) 100%)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Late Payment Penalty & Dues
                  </div>
                  {(paymentPreview?.daysOverdue ?? 0) > 0 ? (
                    <span className="badge badge-warning" style={{ fontSize: 11 }}>
                      {paymentPreview?.daysOverdue} days overdue
                    </span>
                  ) : (
                    <span className="badge badge-route" style={{ fontSize: 11 }}>
                      0 days overdue (On schedule)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>EMI Due Amount</span>
                    <span className="mono font-bold">
                      {formatINR(paymentPreview?.remainingAmount ?? emiDue)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        color:
                          (paymentPreview?.penaltyAmount ?? penaltyDue) > 0
                            ? 'var(--danger-text)'
                            : 'var(--text-secondary)',
                      }}
                    >
                      Late Payment Penalty
                    </span>
                    <span
                      className="mono font-bold"
                      style={{
                        color:
                          (paymentPreview?.penaltyAmount ?? penaltyDue) > 0 ? 'var(--danger-text)' : 'inherit',
                      }}
                    >
                      {(paymentPreview?.penaltyAmount ?? penaltyDue) > 0
                        ? formatINR(paymentPreview?.penaltyAmount ?? penaltyDue)
                        : '₹0 (0 days overdue)'}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      borderTop: '1px dashed var(--border-subtle)',
                      paddingTop: 8,
                      marginTop: 2,
                    }}
                  >
                    <strong style={{ color: 'var(--text-primary)' }}>Total Due</strong>
                    <strong
                      className="mono"
                      style={{
                        fontSize: 15,
                        color:
                          (paymentPreview?.totalDue ?? totalDue) > 0 ? 'var(--primary)' : 'var(--success)',
                      }}
                    >
                      {formatINR(paymentPreview?.totalDue ?? totalDue)}
                    </strong>
                  </div>
                </div>

                {/* Dynamic Application Preview if amount entered */}
                {Number(paymentAmountStr) > 0 && paymentPreview?.allocationPreview && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px solid var(--border-subtle)',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Payment Waterfall Allocation Preview:
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span>1. Penalty portion deducted first:</span>
                      <strong className="mono">
                        {formatINR(paymentPreview.allocationPreview.penaltyAllocated)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span>2. Applied to EMI principal & interest:</span>
                      <strong className="mono">
                        {formatINR(paymentPreview.allocationPreview.principalInterestAllocated)}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Remaining due after payment:</span>
                      <strong
                        className="mono"
                        style={{
                          color:
                            paymentPreview.remainingAfterPayment > 0
                              ? 'var(--warning-text, #d97706)'
                              : 'var(--success)',
                        }}
                      >
                        {formatINR(paymentPreview.remainingAfterPayment)}
                      </strong>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    marginTop: 8,
                    paddingTop: 6,
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <HelpCircle size={12} />
                  <span>Waterfall: 1. Late penalties → 2. Overdue P&I → 3. Current due → 4. Future principal</span>
                </div>
              </div>

              {/* Amount Received Input */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: 4,
                    textTransform: 'uppercase',
                  }}
                >
                  Amount Received (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontWeight: 700,
                      color: 'var(--text-muted)',
                    }}
                  >
                    ₹
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-input mono"
                    style={{ paddingLeft: 28, fontSize: 16, fontWeight: 700 }}
                    value={paymentAmountStr}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    onBlur={handleAmountBlur}
                    placeholder="e.g. 4200"
                    required
                  />
                </div>
              </div>

              {/* Collection Source Badge & Selection */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: 6,
                    textTransform: 'uppercase',
                  }}
                >
                  Payment Source
                </label>

                {isDealer ? (
                  /* Fixed Dealer Source Badge */
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'rgba(184, 83, 47, 0.08)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(184, 83, 47, 0.2)',
                    }}
                  >
                    <span className="badge badge-terracotta" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Store size={12} />
                      <span>DEALER</span>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Collected at store • Unsettled dealer collection
                    </span>
                  </div>
                ) : (
                  /* Super Admin / Admin Collection Source Selector */
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setCollectionSource(CollectionSource.DIRECT_CUSTOMER)}
                        className={`btn btn-sm ${collectionSource === CollectionSource.DIRECT_CUSTOMER ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <Building2 size={13} />
                        <span>DIRECT</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCollectionSource(CollectionSource.DEALER)}
                        className={`btn btn-sm ${collectionSource === CollectionSource.DEALER ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <Store size={13} />
                        <span>DEALER</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setCollectionSource(CollectionSource.RECOVERY_AGENT)}
                        className={`btn btn-sm ${collectionSource === CollectionSource.RECOVERY_AGENT ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <UserCheck size={13} />
                        <span>RECOVERY AGENT</span>
                      </button>
                    </div>

                    {/* Partner Store Selector for Admin */}
                    {collectionSource === CollectionSource.DEALER && (
                      <select
                        className="form-select"
                        value={selectedDealerId}
                        onChange={(e) => setSelectedDealerId(e.target.value)}
                        required
                      >
                        <option value="">-- Select Partner Store --</option>
                        {dealersList.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.storeName} ({d.dealerCode}) — {d.areaCity}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Agent Selector for Admin */}
                    {collectionSource === CollectionSource.RECOVERY_AGENT && (
                      <select
                        className="form-select"
                        value={selectedAgentId}
                        onChange={(e) => setSelectedAgentId(e.target.value)}
                        required
                      >
                        <option value="">-- Select Recovery Agent --</option>
                        {agentsList.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.fullName || ag.full_name} ({ag.phone})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Payment Mode & Reference */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Payment Mode
                  </label>
                  <select
                    className="form-select"
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                  >
                    <option value={PaymentMode.CASH}>Cash (In-Hand)</option>
                    <option value={PaymentMode.UPI}>UPI (QR / App)</option>
                    <option value={PaymentMode.BANK_TRANSFER}>Bank Transfer (NEFT/IMPS)</option>
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Payment Date (DD/MM/YYYY)
                  </label>
                  <div
                    className="form-input mono"
                    style={{
                      background: 'var(--bg-surface-secondary)',
                      color: 'var(--text-primary)',
                      padding: '8px 12px',
                    }}
                  >
                    {formatDateDDMMYYYY(paymentDateStr)}
                  </div>
                </div>
              </div>

              {paymentMode !== PaymentMode.CASH && (
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                    }}
                  >
                    Reference / UTR Number
                  </label>
                  <input
                    type="text"
                    className="form-input mono"
                    placeholder="e.g. UPI Ref / Bank IMPS UTR"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                  />
                </div>
              )}

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    marginBottom: 4,
                    textTransform: 'uppercase',
                  }}
                >
                  Notes / Remark (Optional)
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Handed over at store counter"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn btn-secondary"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting || loadingLoans || loadingPreview}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <CheckCircle2 size={15} />
                  <span>{loadingPreview ? 'Calculating...' : 'Review & Record Payment'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
