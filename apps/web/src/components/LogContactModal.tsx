import React, { useState, useEffect } from 'react';
import {
  ContactMethod,
  ContactOutcome,
  CustomerResponseCategory,
  NonPaymentReason,
  PaymentCommitmentStatus,
  FollowUpPriority,
  formatINR,
} from '@crm/shared';
import { ApiClient } from '../services/api';
import {
  X,
  Phone,
  MessageSquare,
  Mail,
  UserCheck,
  HelpCircle,
  Calendar,
  Clock,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  AlertTriangle,
  Send,
  Search,
} from 'lucide-react';

export interface LogContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (activity: any) => void;
  preselectedCustomer?: {
    id: string;
    fullName: string;
    customerCode?: string;
    primaryPhone?: string;
    areaRoute?: string;
  } | null;
  preselectedLoan?: {
    id: string;
    loanAccountNo: string;
    totalAmount?: number | string;
    outstandingBalance?: number | string;
  } | null;
}

const OUTCOMES_BY_METHOD: Record<ContactMethod, ContactOutcome[]> = {
  [ContactMethod.PHONE_CALL]: [
    ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
    ContactOutcome.NO_ANSWER,
    ContactOutcome.BUSY,
    ContactOutcome.SWITCHED_OFF_UNREACHABLE,
    ContactOutcome.INVALID_NUMBER,
    ContactOutcome.CUSTOMER_REFUSED_TO_TALK,
    ContactOutcome.OTHER,
  ],
  [ContactMethod.WHATSAPP]: [
    ContactOutcome.WHATSAPP_MESSAGE_SENT,
    ContactOutcome.WHATSAPP_MESSAGE_FAILED,
    ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
    ContactOutcome.CUSTOMER_REFUSED_TO_TALK,
    ContactOutcome.OTHER,
  ],
  [ContactMethod.SMS]: [
    ContactOutcome.SMS_SENT,
    ContactOutcome.INVALID_NUMBER,
    ContactOutcome.OTHER,
  ],
  [ContactMethod.IN_PERSON_VISIT]: [
    ContactOutcome.VISIT_COMPLETED,
    ContactOutcome.CUSTOMER_REFUSED_TO_TALK,
    ContactOutcome.SWITCHED_OFF_UNREACHABLE,
    ContactOutcome.OTHER,
  ],
  [ContactMethod.OTHER]: [
    ContactOutcome.ANSWERED_CONVERSATION_COMPLETED,
    ContactOutcome.CUSTOMER_REFUSED_TO_TALK,
    ContactOutcome.OTHER,
  ],
};

export const LogContactModal: React.FC<LogContactModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedCustomer,
  preselectedLoan,
}) => {
  // Step navigation
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: Customer Selection
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customerCode, setCustomerCode] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [loanId, setLoanId] = useState<string>('');
  const [loanAccountNo, setLoanAccountNo] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);

  // Step 2: Contact Method
  const [contactMethod, setContactMethod] = useState<ContactMethod>(ContactMethod.PHONE_CALL);
  const [contactMethodOther, setContactMethodOther] = useState<string>('');
  const [contactPhoneUsed, setContactPhoneUsed] = useState<string>('');

  // Step 3: Attempt Outcome
  const [contactOutcome, setContactOutcome] = useState<ContactOutcome>(
    ContactOutcome.ANSWERED_CONVERSATION_COMPLETED
  );
  const [contactOutcomeOther, setContactOutcomeOther] = useState<string>('');

  // Step 4: Customer Response
  const [responseCategory, setResponseCategory] = useState<CustomerResponseCategory | ''>('');
  const [responseNotes, setResponseNotes] = useState<string>('');

  // Step 5: Reason for Non-Payment
  const [nonPaymentReason, setNonPaymentReason] = useState<NonPaymentReason | ''>('');
  const [nonPaymentReasonNotes, setNonPaymentReasonNotes] = useState<string>('');

  // Step 6: Payment Commitment
  const [hasCommitment, setHasCommitment] = useState<boolean>(false);
  const [promisedAmount, setPromisedAmount] = useState<string>('');
  const [promisedDate, setPromisedDate] = useState<string>('');
  const [paymentModePromised, setPaymentModePromised] = useState<string>('Cash');
  const [commitmentStatus, setCommitmentStatus] = useState<PaymentCommitmentStatus>(
    PaymentCommitmentStatus.PENDING
  );

  // Step 7: Follow-up Scheduling
  const [hasFollowUp, setHasFollowUp] = useState<boolean>(false);
  const [followUpDate, setFollowUpDate] = useState<string>('');
  const [followUpTime, setFollowUpTime] = useState<string>('11:00');
  const [followUpPriority, setFollowUpPriority] = useState<FollowUpPriority>(
    FollowUpPriority.MEDIUM
  );
  const [followUpNotes, setFollowUpNotes] = useState<string>('');
  const [agentNotes, setAgentNotes] = useState<string>('');

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset or prefill on open
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setErrorMsg(null);
      setIsSubmitting(false);
      return;
    }

    if (preselectedCustomer) {
      setCustomerId(preselectedCustomer.id);
      setCustomerName(preselectedCustomer.fullName);
      setCustomerCode(preselectedCustomer.customerCode || '');
      setCustomerPhone(preselectedCustomer.primaryPhone || '');
      setContactPhoneUsed(preselectedCustomer.primaryPhone || '');
    } else {
      setCustomerId('');
      setCustomerName('');
      setCustomerCode('');
      setCustomerPhone('');
      setContactPhoneUsed('');
    }

    if (preselectedLoan) {
      setLoanId(preselectedLoan.id);
      setLoanAccountNo(preselectedLoan.loanAccountNo);
    } else {
      setLoanId('');
      setLoanAccountNo('');
    }

    setContactMethod(ContactMethod.PHONE_CALL);
    setContactMethodOther('');
    setContactOutcome(ContactOutcome.ANSWERED_CONVERSATION_COMPLETED);
    setContactOutcomeOther('');
    setResponseCategory('');
    setResponseNotes('');
    setNonPaymentReason('');
    setNonPaymentReasonNotes('');
    setHasCommitment(false);
    setPromisedAmount('');
    setPromisedDate('');
    setPaymentModePromised('Cash');
    setCommitmentStatus(PaymentCommitmentStatus.PENDING);
    setHasFollowUp(false);
    setFollowUpDate('');
    setFollowUpTime('11:00');
    setFollowUpPriority(FollowUpPriority.MEDIUM);
    setFollowUpNotes('');
    setAgentNotes('');
    setErrorMsg(null);
  }, [isOpen, preselectedCustomer, preselectedLoan]);

  // Method change adjusts available outcomes
  const handleMethodChange = (m: ContactMethod) => {
    setContactMethod(m);
    const validOutcomes = OUTCOMES_BY_METHOD[m] || [ContactOutcome.OTHER];
    if (!validOutcomes.includes(contactOutcome)) {
      setContactOutcome(validOutcomes[0]);
    }
  };

  // Searching assigned customers
  const handleCustomerSearch = async () => {
    if (!customerSearch.trim()) return;
    setSearchLoading(true);
    setErrorMsg(null);
    try {
      const res = await ApiClient.getCustomers(customerSearch.trim(), undefined, 1, 10);
      setSearchResults(res.customers || []);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error searching customers');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectCustomer = (c: any) => {
    setCustomerId(c.id);
    setCustomerName(c.fullName || c.full_name);
    setCustomerCode(c.customerCode || c.customer_code || '');
    setCustomerPhone(c.primaryPhone || c.primary_phone || '');
    setContactPhoneUsed(c.primaryPhone || c.primary_phone || '');
    setSearchResults([]);
    setCustomerSearch('');

    // Preselect active loan if available
    if (c.activeLoans && c.activeLoans.length > 0) {
      setLoanId(c.activeLoans[0].id);
      setLoanAccountNo(c.activeLoans[0].loanAccountNo || c.activeLoans[0].loan_account_no);
    } else if (c.loans && c.loans.length > 0) {
      setLoanId(c.loans[0].id);
      setLoanAccountNo(c.loans[0].loanAccountNo || c.loans[0].loan_account_no);
    } else {
      setLoanId('');
      setLoanAccountNo('');
    }
  };

  // Auto-suggest commitment or follow-up based on response
  const handleResponseChange = (cat: CustomerResponseCategory | '') => {
    setResponseCategory(cat);
    if (
      cat === CustomerResponseCategory.WILL_PAY_TODAY ||
      cat === CustomerResponseCategory.WILL_PAY_ON_SPECIFIC_DATE ||
      cat === CustomerResponseCategory.PARTIAL_PAYMENT_PROMISED
    ) {
      setHasCommitment(true);
      if (cat === CustomerResponseCategory.WILL_PAY_TODAY) {
        setPromisedDate(new Date().toISOString().split('T')[0]);
      }
    }
    if (
      cat === CustomerResponseCategory.REQUESTS_MORE_TIME ||
      cat === CustomerResponseCategory.FINANCIAL_DIFFICULTY ||
      cat === CustomerResponseCategory.DISPUTES_LOAN_AMOUNT
    ) {
      setHasFollowUp(true);
      if (cat === CustomerResponseCategory.FINANCIAL_DIFFICULTY) {
        setNonPaymentReason(NonPaymentReason.TEMPORARY_FINANCIAL_DIFFICULTY);
      }
    }
  };

  // Today string in local date
  const todayStr = new Date().toISOString().split('T')[0];
  const isFollowUpOverdue = hasFollowUp && followUpDate && followUpDate < todayStr;
  const isPromisedDateOverdue = hasCommitment && promisedDate && promisedDate < todayStr;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!customerId) {
      setErrorMsg('Please select an authorized customer to log contact activity.');
      setCurrentStep(1);
      return;
    }

    if (contactMethod === ContactMethod.OTHER && !contactMethodOther.trim()) {
      setErrorMsg('Please provide a description for the "Other" contact method.');
      setCurrentStep(2);
      return;
    }

    if (contactOutcome === ContactOutcome.OTHER && !contactOutcomeOther.trim()) {
      setErrorMsg('Please provide a description for the "Other" contact outcome.');
      setCurrentStep(3);
      return;
    }

    if (nonPaymentReason === NonPaymentReason.OTHER && !nonPaymentReasonNotes.trim()) {
      setErrorMsg('Please provide an explanation for "Other" non-payment reason.');
      setCurrentStep(5);
      return;
    }

    if (hasCommitment) {
      if (!promisedAmount || Number(promisedAmount) <= 0) {
        setErrorMsg('Please enter a valid positive promised payment amount.');
        setCurrentStep(6);
        return;
      }
      if (!promisedDate) {
        setErrorMsg('Please select a promised payment date.');
        setCurrentStep(6);
        return;
      }
    }

    if (hasFollowUp && !followUpDate) {
      setErrorMsg('Please specify the follow-up date.');
      setCurrentStep(7);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const payload: any = {
      customerId,
      loanId: loanId || null,
      contactMethod,
      contactMethodOther: contactMethod === ContactMethod.OTHER ? contactMethodOther.trim() : null,
      contactPhoneUsed: contactPhoneUsed.trim() || null,
      contactOutcome,
      contactOutcomeOther: contactOutcome === ContactOutcome.OTHER ? contactOutcomeOther.trim() : null,
      customerResponseCategory: responseCategory || null,
      customerResponseNotes: responseNotes.trim() || null,
      nonPaymentReason: nonPaymentReason || null,
      nonPaymentReasonNotes: nonPaymentReasonNotes.trim() || null,
      promisedPaymentAmount: hasCommitment && promisedAmount ? Number(promisedAmount) : null,
      promisedPaymentDate: hasCommitment && promisedDate ? promisedDate : null,
      paymentModePromised: hasCommitment ? paymentModePromised : null,
      commitmentStatus: hasCommitment ? commitmentStatus : PaymentCommitmentStatus.PENDING,
      followUpDate: hasFollowUp && followUpDate ? followUpDate : null,
      followUpTime: hasFollowUp && followUpTime ? followUpTime : null,
      followUpPriority: hasFollowUp ? followUpPriority : FollowUpPriority.MEDIUM,
      followUpNotes: hasFollowUp && followUpNotes ? followUpNotes.trim() : null,
      agentNotes: agentNotes.trim() || null,
    };

    try {
      const result = await ApiClient.createContactActivity(payload);
      if (onSuccess) {
        onSuccess(result);
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to log contact activity. Please check authorizations.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        className="crm-card"
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            color: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '8px',
                background: 'rgba(59, 130, 246, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#60a5fa',
              }}
            >
              <Phone size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ffffff' }}>
                Log Customer Contact Activity
              </h3>
              <p style={{ margin: 0, fontSize: 12, color: '#94a3b8' }}>
                Record real recovery interactions, reasons, commitments & follow-up scheduling
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Step Indicator */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            background: '#f8fafc',
            overflowX: 'auto',
          }}
        >
          {[
            { num: 1, label: 'Customer' },
            { num: 2, label: 'Method' },
            { num: 3, label: 'Outcome' },
            { num: 4, label: 'Response' },
            { num: 5, label: 'Reason' },
            { num: 6, label: 'Commitment' },
            { num: 7, label: 'Follow-up' },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setCurrentStep(s.num)}
              style={{
                flex: 1,
                minWidth: '70px',
                padding: '10px 4px',
                border: 'none',
                background: currentStep === s.num ? '#ffffff' : 'transparent',
                borderBottom: currentStep === s.num ? '2px solid var(--primary)' : '2px solid transparent',
                color: currentStep === s.num ? 'var(--primary)' : '#64748b',
                fontWeight: currentStep === s.num ? 700 : 500,
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: currentStep === s.num ? 'var(--primary)' : '#e2e8f0',
                  color: currentStep === s.num ? '#ffffff' : '#64748b',
                  fontSize: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {s.num}
              </span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: '#fef2f2',
              borderBottom: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertCircle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {/* STEP 1: Customer Selection */}
            {currentStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                    Step 1: Authorized Customer & Loan
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    Select an assigned customer from your portfolio. Contact activities are strictly validated against your authorizations.
                  </p>
                </div>

                {customerId ? (
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      border: '1px solid #bfdbfe',
                      backgroundColor: '#eff6ff',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e3a8a' }}>
                        {customerName}
                      </div>
                      <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 2 }}>
                        Ref: {customerCode || customerId.slice(0, 8)} | Phone: {customerPhone || 'N/A'}
                      </div>
                      {loanAccountNo && (
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                          Linked Loan: <strong>{loanAccountNo}</strong>
                        </div>
                      )}
                    </div>
                    {!preselectedCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerId('');
                          setCustomerName('');
                          setCustomerCode('');
                          setCustomerPhone('');
                          setLoanId('');
                          setLoanAccountNo('');
                        }}
                        style={{
                          fontSize: 11,
                          color: '#b91c1c',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        Change
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Search assigned customer name, phone, or code..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleCustomerSearch();
                          }
                        }}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleCustomerSearch}
                        disabled={searchLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Search size={14} />
                        <span>Search</span>
                      </button>
                    </div>

                    {searchLoading && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: 10 }}>
                        Searching assigned customers...
                      </div>
                    )}

                    {searchResults.length > 0 && (
                      <div
                        style={{
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          maxHeight: 180,
                          overflowY: 'auto',
                        }}
                      >
                        {searchResults.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => handleSelectCustomer(c)}
                            style={{
                              padding: '10px 12px',
                              borderBottom: '1px solid var(--border-subtle)',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>
                                {c.fullName || c.full_name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {c.customerCode || c.customer_code} • {c.primaryPhone || c.primary_phone}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                              Select →
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Contact Method */}
            {currentStep === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                    Step 2: Contact Channel
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    Select how you attempted to reach the customer.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                  {[
                    { method: ContactMethod.PHONE_CALL, label: 'Phone Call', icon: <Phone size={18} /> },
                    { method: ContactMethod.WHATSAPP, label: 'WhatsApp', icon: <MessageSquare size={18} /> },
                    { method: ContactMethod.SMS, label: 'SMS', icon: <Mail size={18} /> },
                    { method: ContactMethod.IN_PERSON_VISIT, label: 'In-person Visit', icon: <UserCheck size={18} /> },
                    { method: ContactMethod.OTHER, label: 'Other', icon: <HelpCircle size={18} /> },
                  ].map((m) => (
                    <button
                      key={m.method}
                      type="button"
                      onClick={() => handleMethodChange(m.method)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        padding: '14px 10px',
                        borderRadius: 8,
                        border: contactMethod === m.method ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        backgroundColor: contactMethod === m.method ? '#eff6ff' : '#ffffff',
                        color: contactMethod === m.method ? 'var(--primary)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        fontWeight: contactMethod === m.method ? 700 : 500,
                      }}
                    >
                      {m.icon}
                      <span style={{ fontSize: 12 }}>{m.label}</span>
                    </button>
                  ))}
                </div>

                {contactMethod === ContactMethod.OTHER && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Describe Contact Method <span style={{ color: '#b91c1c' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g., Telegram, Field Office Counter, Reference Contact..."
                      value={contactMethodOther}
                      onChange={(e) => setContactMethodOther(e.target.value)}
                      required
                    />
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Contact Phone / Handle Used
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. +91 9876543210"
                    value={contactPhoneUsed}
                    onChange={(e) => setContactPhoneUsed(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* STEP 3: Attempt Outcome */}
            {currentStep === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                    Step 3: Contact Attempt Outcome
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    Select the actual outcome of the interaction.
                  </p>
                </div>

                {/* Telephony transparency badge */}
                <div
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fef3c7',
                    color: '#92400e',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>Verification Notice:</strong> This log records what you report about the contact attempt. Opening WhatsApp or dialing does not verify telco delivery or call completion.
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(OUTCOMES_BY_METHOD[contactMethod] || []).map((outcome) => (
                    <label
                      key={outcome}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 6,
                        border: contactOutcome === outcome ? '1.5px solid var(--primary)' : '1px solid var(--border-subtle)',
                        backgroundColor: contactOutcome === outcome ? '#eff6ff' : '#ffffff',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: contactOutcome === outcome ? 600 : 400,
                      }}
                    >
                      <input
                        type="radio"
                        name="contactOutcome"
                        value={outcome}
                        checked={contactOutcome === outcome}
                        onChange={() => setContactOutcome(outcome)}
                      />
                      <span>{outcome.replace(/_/g, ' ')}</span>
                    </label>
                  ))}
                </div>

                {contactOutcome === ContactOutcome.OTHER && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Describe Outcome <span style={{ color: '#b91c1c' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Specify the exact interaction outcome..."
                      value={contactOutcomeOther}
                      onChange={(e) => setContactOutcomeOther(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Customer Response */}
            {currentStep === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                    Step 4: Customer's Response & Conversation Summary
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    Categorize what the customer stated and provide an authentic summary of the conversation.
                  </p>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Customer Response Category
                  </label>
                  <select
                    className="form-select"
                    value={responseCategory}
                    onChange={(e) => handleResponseChange(e.target.value as CustomerResponseCategory)}
                  >
                    <option value="">-- Select Response Category --</option>
                    <option value={CustomerResponseCategory.WILL_PAY_TODAY}>Will Pay Today</option>
                    <option value={CustomerResponseCategory.WILL_PAY_ON_SPECIFIC_DATE}>Will Pay on a Specific Date</option>
                    <option value={CustomerResponseCategory.PARTIAL_PAYMENT_PROMISED}>Partial Payment Promised</option>
                    <option value={CustomerResponseCategory.REQUESTS_MORE_TIME}>Requests More Time</option>
                    <option value={CustomerResponseCategory.FINANCIAL_DIFFICULTY}>Financial Difficulty</option>
                    <option value={CustomerResponseCategory.DISPUTES_LOAN_AMOUNT}>Disputes Loan / Amount</option>
                    <option value={CustomerResponseCategory.SAYS_ALREADY_PAID}>Says Already Paid</option>
                    <option value={CustomerResponseCategory.REFUSES_TO_PAY}>Refuses to Pay</option>
                    <option value={CustomerResponseCategory.UNABLE_TO_CONTACT}>Unable to Contact Customer</option>
                    <option value={CustomerResponseCategory.WRONG_CONTACT_DETAILS}>Wrong Contact Details</option>
                    <option value={CustomerResponseCategory.OTHER}>Other Response</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Customer's Response / Conversation Summary
                  </label>
                  <textarea
                    className="form-input"
                    rows={4}
                    placeholder="Record what the customer actually said. Do not invent automated answers..."
                    value={responseNotes}
                    onChange={(e) => setResponseNotes(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            )}

            {/* STEP 5: Reason for Non-Payment */}
            {currentStep === 5 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                    Step 5: Reason for Non-Payment
                  </h4>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                    If the customer is in default or unable to pay today, capture the specific root cause.
                  </p>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Non-Payment Reason
                  </label>
                  <select
                    className="form-select"
                    value={nonPaymentReason}
                    onChange={(e) => setNonPaymentReason(e.target.value as NonPaymentReason)}
                  >
                    <option value="">-- No Non-Payment Reason (Full Payment Made) --</option>
                    <option value={NonPaymentReason.SALARY_DELAYED}>Salary Delayed</option>
                    <option value={NonPaymentReason.TEMPORARY_FINANCIAL_DIFFICULTY}>Temporary Financial Difficulty</option>
                    <option value={NonPaymentReason.MEDICAL_EMERGENCY}>Medical Emergency</option>
                    <option value={NonPaymentReason.BUSINESS_INCOME_LOSS}>Business / Income Loss</option>
                    <option value={NonPaymentReason.PAYMENT_ALREADY_MADE_VERIFICATION_REQUIRED}>Payment Already Made — Verification Required</option>
                    <option value={NonPaymentReason.EMI_PENALTY_DISPUTE}>EMI / Penalty Dispute</option>
                    <option value={NonPaymentReason.DISPUTE_ABOUT_LOAN_TERMS}>Dispute About Loan Terms</option>
                    <option value={NonPaymentReason.TECHNICAL_PAYMENT_ISSUE}>Technical Payment Issue</option>
                    <option value={NonPaymentReason.CUSTOMER_UNREACHABLE}>Customer Unreachable</option>
                    <option value={NonPaymentReason.CUSTOMER_REFUSED}>Customer Refused</option>
                    <option value={NonPaymentReason.OTHER}>Other Reason</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Detailed Non-Payment Explanation {nonPaymentReason === NonPaymentReason.OTHER && <span style={{ color: '#b91c1c' }}>*</span>}
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Provide additional details regarding the non-payment explanation..."
                    value={nonPaymentReasonNotes}
                    onChange={(e) => setNonPaymentReasonNotes(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            )}

            {/* STEP 6: Payment Commitment */}
            {currentStep === 6 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                      Step 6: Payment Commitment
                    </h4>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                      Record promises to pay made by the customer.
                    </p>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={hasCommitment}
                      onChange={(e) => setHasCommitment(e.target.checked)}
                    />
                    <span>Customer Promised to Pay</span>
                  </label>
                </div>

                {hasCommitment ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 8,
                      border: '1px solid #bbf7d0',
                      backgroundColor: '#f0fdf4',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={14} />
                      <span>
                        <strong>Note:</strong> Recording a commitment tracks agent recovery promises. It does <em>not</em> create a financial ledger entry or reduce the loan balance.
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Promised Amount (₹) <span style={{ color: '#b91c1c' }}>*</span>
                        </label>
                        <input
                          type="number"
                          className="form-input"
                          placeholder="e.g. 2500"
                          value={promisedAmount}
                          onChange={(e) => setPromisedAmount(e.target.value)}
                          min="1"
                          required
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Promised Date <span style={{ color: '#b91c1c' }}>*</span>
                        </label>
                        <input
                          type="date"
                          className="form-input"
                          value={promisedDate}
                          onChange={(e) => setPromisedDate(e.target.value)}
                          required
                        />
                        {isPromisedDateOverdue && (
                          <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
                            ⚠️ Warning: Promised date is in the past
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Payment Mode
                        </label>
                        <select
                          className="form-select"
                          value={paymentModePromised}
                          onChange={(e) => setPaymentModePromised(e.target.value)}
                        >
                          <option value="Cash">Cash</option>
                          <option value="UPI">UPI</option>
                          <option value="Netbanking">Netbanking</option>
                          <option value="Cheque">Cheque</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Commitment Status
                        </label>
                        <select
                          className="form-select"
                          value={commitmentStatus}
                          onChange={(e) => setCommitmentStatus(e.target.value as PaymentCommitmentStatus)}
                        >
                          <option value={PaymentCommitmentStatus.PENDING}>Pending</option>
                          <option value={PaymentCommitmentStatus.FULFILLED}>Fulfilled</option>
                          <option value={PaymentCommitmentStatus.BROKEN}>Broken</option>
                          <option value={PaymentCommitmentStatus.CANCELLED}>Cancelled</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: 20,
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      border: '1px dashed var(--border-subtle)',
                      borderRadius: 8,
                    }}
                  >
                    No payment commitment for this contact attempt. Check the box above if the customer promised to pay.
                  </div>
                )}
              </div>
            )}

            {/* STEP 7: Follow-up Scheduling */}
            {currentStep === 7 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>
                      Step 7: Next Follow-up & Agent Notes
                    </h4>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
                      Schedule subsequent contact reminders and internal agent notes.
                    </p>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={hasFollowUp}
                      onChange={(e) => setHasFollowUp(e.target.checked)}
                    />
                    <span>Schedule Follow-up</span>
                  </label>
                </div>

                {hasFollowUp && (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 8,
                      border: '1px solid #fed7aa',
                      backgroundColor: '#fff7ed',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Follow-up Date <span style={{ color: '#b91c1c' }}>*</span>
                        </label>
                        <input
                          type="date"
                          className="form-input"
                          value={followUpDate}
                          onChange={(e) => setFollowUpDate(e.target.value)}
                          required
                        />
                        {isFollowUpOverdue && (
                          <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>
                            ⚠️ Warning: Follow-up date is in the past
                          </div>
                        )}
                      </div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                          Time
                        </label>
                        <input
                          type="time"
                          className="form-input"
                          value={followUpTime}
                          onChange={(e) => setFollowUpTime(e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Priority
                      </label>
                      <select
                        className="form-select"
                        value={followUpPriority}
                        onChange={(e) => setFollowUpPriority(e.target.value as FollowUpPriority)}
                      >
                        <option value={FollowUpPriority.LOW}>Low</option>
                        <option value={FollowUpPriority.MEDIUM}>Medium</option>
                        <option value={FollowUpPriority.HIGH}>High</option>
                        <option value={FollowUpPriority.URGENT}>Urgent</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Follow-up Action Note
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Call back at 11 AM after customer gets salary SMS"
                        value={followUpNotes}
                        onChange={(e) => setFollowUpNotes(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Internal Agent Notes (Private & Audited)
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Enter internal notes for supervisor/next agent..."
                    value={agentNotes}
                    onChange={(e) => setAgentNotes(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer Controls */}
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border-subtle)',
              backgroundColor: '#f8fafc',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              {currentStep > 1 && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setCurrentStep((prev) => prev - 1)}
                  disabled={isSubmitting}
                >
                  ← Back
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>

              {currentStep < 7 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setCurrentStep((prev) => prev + 1)}
                >
                  Next Step →
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting || !customerId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    backgroundColor: '#16a34a',
                    borderColor: '#16a34a',
                  }}
                >
                  {isSubmitting ? (
                    <>
                      <div
                        className="animate-spin"
                        style={{
                          width: 14,
                          height: 14,
                          border: '2px solid #ffffff',
                          borderTopColor: 'transparent',
                          borderRadius: '50%',
                        }}
                      />
                      <span>Saving Contact Log...</span>
                    </>
                  ) : (
                    <>
                      <Send size={15} />
                      <span>Save & Complete Log</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
