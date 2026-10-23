import React, { useState, useEffect, useRef } from 'react';
import { ApiClient } from '../services/api';
import {
  KYCType,
  InterestMethod,
  RepaymentFrequency,
  formatINR,
  formatDateDDMMYYYY,
  parseDisplayDateToISO,
  getBusinessDateStr,
  calculateNextDueDate,
  ICustomer,
  ILoan,
  IDealer,
  UserRole,
  normalizeNumericLeadingZeros,
  ALLOWED_MONTHLY_INTEREST_RATES,
  DEALER_ALLOWED_INTEREST_RATES,
} from '@crm/shared';
import { MediaUploader, MediaUploadResult } from './MediaUploader';
import { DynamicAttachmentManager, AttachmentItem } from './DynamicAttachmentManager';
import { PortalLinkManager } from './PortalLinkManager';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  User,
  ShieldCheck,
  Smartphone,
  Calculator,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  Plus,
  Store,
  RefreshCw,
  Calendar,
} from 'lucide-react';

interface AddCustomerWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (customer: ICustomer, loan?: ILoan) => void;
}

const initialKycAttachments: AttachmentItem[] = [
  {
    id: 'kyc_aadhaar_front',
    category: 'Aadhaar Front',
    title: '',
    file: null,
    previewUrl: null,
    mimeType: '',
    fileSizeBytes: 0,
    status: 'READY',
  },
  {
    id: 'kyc_aadhaar_back',
    category: 'Aadhaar Back',
    title: '',
    file: null,
    previewUrl: null,
    mimeType: '',
    fileSizeBytes: 0,
    status: 'READY',
  },
];

const initialProductAttachments: AttachmentItem[] = [
  {
    id: 'prod_front',
    category: 'Product Front View',
    title: '',
    file: null,
    previewUrl: null,
    mimeType: '',
    fileSizeBytes: 0,
    status: 'READY',
  },
  {
    id: 'prod_invoice',
    category: 'Invoice Proof Photo',
    title: '',
    file: null,
    previewUrl: null,
    mimeType: '',
    fileSizeBytes: 0,
    status: 'READY',
  },
];

export function useBodyScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);
}

export const AddCustomerWizard: React.FC<AddCustomerWizardProps> = ({ isOpen, onClose, onSuccess }) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [dealers, setDealers] = useState<IDealer[]>([]);
  const [selectedDealerId, setSelectedDealerId] = useState<string>('');

  const currentUser = ApiClient.getUser();
  const isDealer = currentUser?.role === UserRole.DEALER;

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // STEP 1: Customer Details
  const [fullName, setFullName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState('Delhi');
  const [state, setState] = useState('Delhi');
  const [pincode, setPincode] = useState('110001');
  const [areaRoute, setAreaRoute] = useState('');
  const [customerPhoto, setCustomerPhoto] = useState<MediaUploadResult | null>(null);

  // STEP 2: Dynamic KYC Documents (NO artificial limits)
  const [kycAttachments, setKycAttachments] = useState<AttachmentItem[]>([...initialKycAttachments]);

  // STEP 3: Product / Device Information & Dynamic Device Photos (NO artificial limits)
  const [productType, setProductType] = useState('Mobile Phone');
  const [productBrand, setProductBrand] = useState('');
  const [productModel, setProductModel] = useState('');
  const [imeiNumber, setImeiNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [productPrice, setProductPrice] = useState<number>(30000);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);

  const [productAttachments, setProductAttachments] = useState<AttachmentItem[]>([...initialProductAttachments]);

  // STEP 4: EMI / Finance Configuration
  const [downPayment, setDownPayment] = useState<number>(5000);
  const [annualRate, setAnnualRate] = useState<number>(4);
  const [calcMethod] = useState<InterestMethod>(InterestMethod.FLAT_RATE);
  const [tenureMonths, setTenureMonths] = useState<number>(6);
  const [frequency] = useState<RepaymentFrequency>(RepaymentFrequency.MONTHLY);
  const [disbursementDate, setDisbursementDate] = useState(() => getBusinessDateStr());
  const [firstEmiDate, setFirstEmiDate] = useState(() => calculateNextDueDate(getBusinessDateStr(), 1, RepaymentFrequency.MONTHLY));
  const [disbDisplay, setDisbDisplay] = useState(() => formatDateDDMMYYYY(getBusinessDateStr()));
  const [firstEmiDisplay, setFirstEmiDisplay] = useState(() => formatDateDDMMYYYY(calculateNextDueDate(getBusinessDateStr(), 1, RepaymentFrequency.MONTHLY)));

  const handleDisbDateChange = (isoDate: string) => {
    setDisbursementDate(isoDate);
    setDisbDisplay(formatDateDDMMYYYY(isoDate));
    const nextDue = calculateNextDueDate(isoDate, 1, RepaymentFrequency.MONTHLY);
    setFirstEmiDate(nextDue);
    setFirstEmiDisplay(formatDateDDMMYYYY(nextDue));
  };

  const handleDisbDisplayChange = (displayVal: string) => {
    setDisbDisplay(displayVal);
    const parsed = parseDisplayDateToISO(displayVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      setDisbursementDate(parsed);
      const nextDue = calculateNextDueDate(parsed, 1, RepaymentFrequency.MONTHLY);
      setFirstEmiDate(nextDue);
      setFirstEmiDisplay(formatDateDDMMYYYY(nextDue));
    }
  };

  const handleFirstEmiDateChange = (isoDate: string) => {
    setFirstEmiDate(isoDate);
    setFirstEmiDisplay(formatDateDDMMYYYY(isoDate));
  };

  const handleFirstEmiDisplayChange = (displayVal: string) => {
    setFirstEmiDisplay(displayVal);
    const parsed = parseDisplayDateToISO(displayVal);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      setFirstEmiDate(parsed);
    }
  };

  // Server Calculated Preview
  const [previewSchedule, setPreviewSchedule] = useState<any | null>(null);
  const [calculatingPreview, setCalculatingPreview] = useState(false);

  // Final Success Summary State
  const [createdResult, setCreatedResult] = useState<{ customer: ICustomer; loan: ILoan } | null>(null);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [retryingPhoto, setRetryingPhoto] = useState(false);
  const [photoUploadSuccess, setPhotoUploadSuccess] = useState(false);
  const [kycUploadErrors, setKycUploadErrors] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => 'onb_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9));

  const resetWizard = () => {
    setCurrentStep(1);
    setSubmitting(false);
    setErrorMsg(null);
    setPhotoUploadError(null);
    setRetryingPhoto(false);
    setPhotoUploadSuccess(false);
    setKycUploadErrors([]);
    setIdempotencyKey('onb_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9));
    setCreatedResult(null);
    setPreviewSchedule(null);
    setSelectedDealerId(isDealer && currentUser?.dealerId ? currentUser.dealerId : '');
    setFullName('');
    setPrimaryPhone('');
    setAlternatePhone('');
    setAddressLine1('');
    setAddressLine2('');
    setLandmark('');
    setCity('Delhi');
    setState('Delhi');
    setPincode('110001');
    setAreaRoute('');
    setCustomerPhoto(null);
    setKycAttachments([...initialKycAttachments]);
    setProductAttachments([...initialProductAttachments]);
    setProductType('Mobile Phone');
    setProductBrand('');
    setProductModel('');
    setImeiNumber('');
    setSerialNumber('');
    setProductPrice(30000);
    setInvoiceNumber('');
    setInvoiceDate(getBusinessDateStr());
    setDownPayment(5000);
    setAnnualRate(4);
    setTenureMonths(6);
    const today = getBusinessDateStr();
    setDisbursementDate(today);
    setDisbDisplay(formatDateDDMMYYYY(today));
    const firstEmi = calculateNextDueDate(today, 1, RepaymentFrequency.MONTHLY);
    setFirstEmiDate(firstEmi);
    setFirstEmiDisplay(formatDateDDMMYYYY(firstEmi));
  };

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const stepContentRef = useRef<HTMLDivElement>(null);

  // Background body scroll locking while modal is open, restoring previous overflow style on close or unmount
  useBodyScrollLock(isOpen);

  // Reset scroll position to top when transitioning between wizard steps
  useEffect(() => {
    if (stepContentRef.current) {
      stepContentRef.current.scrollTop = 0;
    }
  }, [currentStep]);

  // Scroll to top of content container if an error message is triggered
  useEffect(() => {
    if (errorMsg && stepContentRef.current) {
      stepContentRef.current.scrollTop = 0;
    }
  }, [errorMsg]);

  useEffect(() => {
    if (isOpen) {
      resetWizard();
      if (isDealer && currentUser?.dealerId) {
        setSelectedDealerId(currentUser.dealerId);
      }
      ApiClient.getDealers(undefined, 'ACTIVE')
        .then((data) => {
          setDealers(data);
          if (isDealer && currentUser?.dealerId) {
            setSelectedDealerId(currentUser.dealerId);
          }
        })
        .catch((err) => console.error('Failed to load active dealers', err));
    }
  }, [isOpen]);

  // Trigger server-authoritative preview calculation
  const handleFetchPreview = async () => {
    const financed = Math.max(0, productPrice - downPayment);
    if (financed <= 0) {
      setErrorMsg('Financed amount must be greater than zero. Down payment cannot equal or exceed product price.');
      setPreviewSchedule(null);
      return;
    }
    if (!firstEmiDate) {
      setPreviewSchedule(null);
      return;
    }
    if (firstEmiDate < disbursementDate) {
      setErrorMsg('EMI Start Date cannot be earlier than loan origination date.');
      setPreviewSchedule(null);
      return;
    }
    if (!tenureMonths || tenureMonths <= 0) {
      setErrorMsg('EMI Tenure must be a positive integer.');
      setPreviewSchedule(null);
      return;
    }

    setCalculatingPreview(true);
    setErrorMsg(null);
    try {
      const res = await ApiClient.calculateLoanPreview({
        principalAmount: Number(productPrice),
        downPayment: Number(downPayment),
        annualInterestRate: Number(annualRate),
        interestCalcMethod: calcMethod,
        tenureMonths: Number(tenureMonths),
        installmentFrequency: frequency,
        disbursementDate,
        firstEmiDate,
      });
      setPreviewSchedule(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to calculate EMI preview from server.');
      setPreviewSchedule(null);
    } finally {
      setCalculatingPreview(false);
    }
  };

  // Auto-recalculate preview when configuration changes in Step 4
  useEffect(() => {
    if (!isOpen || currentStep !== 4) return;
    const financed = Math.max(0, productPrice - downPayment);
    if (financed <= 0 || !tenureMonths || tenureMonths <= 0 || !firstEmiDate) {
      setPreviewSchedule(null);
      return;
    }
    if (firstEmiDate < disbursementDate) {
      setErrorMsg('EMI Start Date cannot be earlier than loan origination date.');
      setPreviewSchedule(null);
      return;
    }

    const timer = setTimeout(() => {
      handleFetchPreview();
    }, 200);

    return () => clearTimeout(timer);
  }, [productPrice, downPayment, annualRate, calcMethod, tenureMonths, frequency, disbursementDate, firstEmiDate, currentStep, isOpen]);

  const handleNext = async () => {
    setErrorMsg(null);

    if (currentStep === 1) {
      if (!fullName.trim() || !primaryPhone.trim() || !addressLine1.trim() || !areaRoute.trim() || !pincode.trim()) {
        setErrorMsg('Please complete all required customer fields including Collection Area / Route.');
        return;
      }
      if (addressLine1.trim().length < 5) {
        setErrorMsg('Address line 1 must be at least 5 characters.');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      setCurrentStep(3);
    } else if (currentStep === 3) {
      if (!productBrand.trim() || !productModel.trim() || productPrice <= 0) {
        setErrorMsg('Please specify product brand, model, and valid cash price.');
        return;
      }
      if (isDealer && !currentUser?.dealerId) {
        setErrorMsg('Dealer partner account context is required.');
        return;
      }
      setCurrentStep(4);
      setTimeout(handleFetchPreview, 50);
    } else if (currentStep === 4) {
      if (!firstEmiDate) {
        setErrorMsg('EMI Start Date is required. Select the date when the first EMI becomes due.');
        return;
      }
      if (firstEmiDate < disbursementDate) {
        setErrorMsg('EMI Start Date cannot be earlier than loan origination date.');
        return;
      }
      if (!tenureMonths || tenureMonths <= 0) {
        setErrorMsg('EMI Tenure must be a positive integer.');
        return;
      }
      const financed = Math.max(0, productPrice - downPayment);
      if (financed <= 0) {
        setErrorMsg('Financed amount must be greater than zero. Down payment cannot equal or exceed product price.');
        return;
      }
      await handleFetchPreview();
      setCurrentStep(5);
    }
  };

  const handlePrev = () => {
    setErrorMsg(null);
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as any);
    }
  };

  const handleRetryPhotoUpload = async () => {
    if (!createdResult?.customer?.id || !customerPhoto?.file) return;
    setRetryingPhoto(true);
    setPhotoUploadError(null);

    try {
      const uploadRes = await ApiClient.uploadCustomerPhoto(createdResult.customer.id, customerPhoto.file);
      if (uploadRes?.photoUrl) {
        setCreatedResult({
          ...createdResult,
          customer: {
            ...createdResult.customer,
            photoUrl: uploadRes.photoUrl,
          },
        });
        setPhotoUploadSuccess(true);
      }
    } catch (photoErr: any) {
      console.warn('Customer photo storage upload retry error:', photoErr);
      setPhotoUploadError(photoErr.message || 'Customer photo upload failed. Please try again.');
    } finally {
      setRetryingPhoto(false);
    }
  };

  const handleFinalSubmit = async () => {
    // If customer and loan were already created in this wizard session,
    // do NOT call onboardCustomer again to avoid duplicate records!
    if (createdResult) {
      if (customerPhoto?.file && (!createdResult.customer.photoUrl || photoUploadError)) {
        await handleRetryPhotoUpload();
      }
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setPhotoUploadError(null);
    setPhotoUploadSuccess(false);

    try {
      // 1. Atomic Customer + Loan Onboarding (all-or-nothing database transaction)
      const financedAmount = Math.max(0, productPrice - downPayment);
      if (financedAmount <= 0) {
        setErrorMsg('Financed amount must be greater than zero. Down payment cannot equal or exceed product price.');
        setSubmitting(false);
        return;
      }
      const effectiveDealerId = isDealer && currentUser?.dealerId ? currentUser.dealerId : selectedDealerId;

      const onboardResult = await ApiClient.onboardCustomer({
        customer: {
          fullName: fullName.trim(),
          primaryPhone: primaryPhone.trim(),
          alternatePhone: alternatePhone.trim() || undefined,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          landmark: landmark.trim() || undefined,
          city: city.trim(),
          state: state.trim(),
          pincode: pincode.trim(),
          areaRoute: areaRoute.trim(),
          // Avoid sending multi-megabyte Base64 image in JSON body.
          // Binary photo file is uploaded below via the secure KYC storage vault.
          photoUrl: customerPhoto?.file ? undefined : (customerPhoto?.previewUrl || undefined),
        },
        loan: {
          principalAmount: Number(productPrice),
          downPayment: Number(downPayment),
          annualInterestRate: Number(annualRate),
          interestCalcMethod: calcMethod,
          tenureMonths: Number(tenureMonths),
          installmentFrequency: frequency,
          disbursementDate,
          firstEmiDate: firstEmiDate || undefined,
          dealerId: effectiveDealerId || undefined,
          deviceBrand: productBrand.trim() || undefined,
          deviceModel: productModel.trim() || undefined,
          deviceName: `${productBrand} ${productModel}`.trim() || undefined,
          imei1: imeiNumber.trim() || undefined,
          imei2: serialNumber.trim() || undefined,
          deviceStatus: 'ACTIVE',
        },
        idempotencyKey,
      });

      const newCustomer = onboardResult.customer;
      const newLoan = onboardResult.loan || undefined;

      // 2. Upload Customer Main Photo via dedicated photo endpoint if attached
      if (customerPhoto?.file) {
        try {
          const uploadRes = await ApiClient.uploadCustomerPhoto(newCustomer.id, customerPhoto.file);
          if (uploadRes?.photoUrl) {
            newCustomer.photoUrl = uploadRes.photoUrl;
            setPhotoUploadSuccess(true);
          }
        } catch (photoErr: any) {
          console.warn('Customer photo storage upload note:', photoErr);
          setPhotoUploadError(photoErr.message || 'Photo upload to secure vault failed. Customer profile was created.');
        }
      }

      // 3. Upload / Confirm KYC Documents for the newly created customer
      const failedKycDocs: string[] = [];
      for (const kyc of kycAttachments) {
        if (kyc.file) {
          try {
            let docType: KYCType = KYCType.OTHER;
            const cat = kyc.category.toLowerCase();
            if (cat.includes('aadhaar')) docType = KYCType.AADHAAR;
            else if (cat.includes('pan')) docType = KYCType.PAN;
            else if (cat.includes('voter')) docType = KYCType.VOTER_ID;
            else if (cat.includes('driving')) docType = KYCType.DRIVING_LICENSE;

            await ApiClient.uploadKYCDocument({
              customerId: newCustomer.id,
              docType,
              docNumber: kyc.title || null,
              file: kyc.file,
            });
          } catch (e: any) {
            console.warn('KYC item registration note:', e);
            failedKycDocs.push(`${kyc.category || 'Document'}: ${e.message || 'Upload failed'}`);
          }
        }
      }

      if (failedKycDocs.length > 0) {
        setKycUploadErrors(failedKycDocs);
      }

      setCreatedResult({ customer: newCustomer, loan: newLoan! });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error creating customer & loan agreement.');
    } finally {
      setSubmitting(false);
    }
  };

  const steps = [
    { num: 1, label: 'Customer Info', icon: <User size={15} /> },
    { num: 2, label: 'KYC Vault', icon: <ShieldCheck size={15} /> },
    { num: 3, label: 'Financed Item', icon: <Smartphone size={15} /> },
    { num: 4, label: 'EMI Terms', icon: <Calculator size={15} /> },
    { num: 5, label: 'Review & Book', icon: <FileSpreadsheet size={15} /> },
  ];

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div
        className="modal-content wizard-modal-container"
        style={{
          width: '100%',
          maxWidth: 780,
          maxHeight: 'min(90vh, 920px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-surface-secondary)',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800 }}>New Borrower & Financed Product Onboarding</h2>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Step-by-step customer onboarding, private KYC verification, device registration & EMI origination
            </div>
          </div>
          <button
            onClick={() => {
              if (createdResult) {
                onSuccess(createdResult.customer, createdResult.loan);
              }
              handleClose();
            }}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Success Screen */}
        {createdResult ? (
          <div
            style={{
              padding: 36,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: photoUploadError ? 'rgba(234, 88, 12, 0.12)' : 'var(--success-bg)',
                border: photoUploadError ? '1px solid rgba(234, 88, 12, 0.3)' : '1px solid var(--success-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: photoUploadError ? '#ea580c' : 'var(--success)',
                marginBottom: 16,
              }}
            >
              {photoUploadError ? <AlertCircle size={32} /> : <CheckCircle2 size={32} />}
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
              {photoUploadError ? 'Borrower Created (Photo Upload Pending)' : 'Borrower Onboarded Successfully!'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 460, marginTop: 6 }}>
              {photoUploadError
                ? 'The customer profile and loan agreement were safely registered, but the customer live photo upload could not be completed.'
                : 'The customer profile, financed device record, and amortization schedule have been safely registered.'}
            </p>

            {/* Photo Upload Incomplete Banner & Retry Button */}
            {photoUploadError && (
              <div
                style={{
                  marginTop: 20,
                  padding: 16,
                  background: 'rgba(234, 88, 12, 0.08)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(234, 88, 12, 0.3)',
                  width: '100%',
                  maxWidth: 460,
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c2410c', fontWeight: 700, fontSize: 13 }}>
                  <AlertCircle size={16} />
                  <span>Photo Upload Incomplete</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                  <span>Reason: </span>
                  <span style={{ color: '#c2410c', fontWeight: 600 }}>{photoUploadError}</span>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={handleRetryPhotoUpload}
                    disabled={retryingPhoto}
                    className="btn btn-primary btn-sm"
                    style={{ background: '#ea580c', borderColor: '#c2410c', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <RefreshCw size={13} className={retryingPhoto ? 'spin' : ''} />
                    <span>{retryingPhoto ? 'Retrying Photo Upload...' : 'Retry Photo Upload'}</span>
                  </button>
                </div>
              </div>
            )}

            {photoUploadSuccess && (
              <div
                style={{
                  marginTop: 16,
                  padding: '10px 16px',
                  background: 'var(--success-bg)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--success-border)',
                  color: 'var(--success)',
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  maxWidth: 460,
                  textAlign: 'left',
                }}
              >
                <CheckCircle2 size={16} />
                <span>Customer live photo successfully uploaded to vault & linked to profile!</span>
              </div>
            )}

            {kycUploadErrors.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: 'rgba(234, 88, 12, 0.08)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(234, 88, 12, 0.3)',
                  width: '100%',
                  maxWidth: 460,
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c2410c', fontWeight: 700, fontSize: 13 }}>
                  <AlertCircle size={16} />
                  <span>{kycUploadErrors.length} KYC Document(s) Pending Storage Upload</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.4 }}>
                  The borrower profile and loan were created, but the following documents could not be stored in the vault:
                  <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                    {kycUploadErrors.map((err, idx) => (
                      <li key={idx} style={{ color: '#c2410c', fontWeight: 500 }}>{err}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>
                    You can retry uploading these documents from the Customer Details profile at any time.
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: 'var(--bg-surface-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                width: '100%',
                maxWidth: 460,
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Borrower Code:</span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                  {createdResult.customer.customerCode}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Customer Name:</span>
                <span style={{ fontWeight: 600 }}>{createdResult.customer.fullName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Area / Route:</span>
                <span style={{ fontWeight: 600 }}>{createdResult.customer.areaRoute}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loan Account No:</span>
                <span className="mono" style={{ fontWeight: 700 }}>
                  {createdResult.loan.loanAccountNo}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Monthly Installment:</span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--success)' }}>
                  {formatINR(createdResult.loan.emiAmount)}
                </span>
              </div>
            </div>

            {createdResult.loan && (
              <div style={{ marginTop: 20, width: '100%', maxWidth: 460, textAlign: 'left' }}>
                <PortalLinkManager
                  loanId={createdResult.loan.id}
                  loanAccountNo={createdResult.loan.loanAccountNo}
                  customerName={createdResult.customer.fullName}
                  primaryPhone={createdResult.customer.primaryPhone}
                  userRole={currentUser?.role}
                />
              </div>
            )}

            <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
              {photoUploadError && (
                <button
                  type="button"
                  onClick={handleRetryPhotoUpload}
                  disabled={retryingPhoto}
                  className="btn btn-secondary btn-lg"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={14} className={retryingPhoto ? 'spin' : ''} />
                  <span>{retryingPhoto ? 'Retrying...' : 'Retry Photo Upload'}</span>
                </button>
              )}
              <button
                onClick={() => {
                  onSuccess(createdResult.customer, createdResult.loan);
                  handleClose();
                }}
                className="btn btn-primary btn-lg"
              >
                {photoUploadError ? 'Proceed to Directory Anyway' : 'Done & View Directory'}
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {/* Step Progress Bar */}
            <div
              style={{
                display: 'flex',
                background: '#ffffff',
                borderBottom: '1px solid var(--border-subtle)',
                padding: '10px 16px',
                overflowX: 'auto',
                flexShrink: 0,
              }}
            >
              {steps.map((s, idx) => {
                const isActive = currentStep === s.num;
                const isCompleted = currentStep > s.num;
                return (
                  <div
                    key={s.num}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flex: 1,
                      minWidth: 120,
                      opacity: isActive || isCompleted ? 1 : 0.5,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        color: isActive ? 'var(--primary)' : isCompleted ? 'var(--success)' : 'var(--text-secondary)',
                      }}
                    >
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: isActive
                            ? 'var(--primary-subtle)'
                            : isCompleted
                            ? 'var(--success-bg)'
                            : 'var(--bg-surface-secondary)',
                          border: `1px solid ${
                            isActive ? 'var(--primary)' : isCompleted ? 'var(--success-border)' : 'var(--border-subtle)'
                          }`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {isCompleted ? <Check size={13} /> : s.num}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500 }}>{s.label}</span>
                    </div>
                    {idx < steps.length - 1 && (
                      <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)', margin: '0 8px' }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Step Content Container */}
            <div
              ref={stepContentRef}
              className="wizard-step-content"
              style={{
                padding: 24,
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
              }}
            >
              {errorMsg && (
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'var(--danger-bg)',
                    border: '1px solid var(--danger-border)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--danger-text)',
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <AlertCircle size={16} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* STEP 1: Customer */}
              {currentStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Borrower Full Name <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Ramesh Kumar"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Primary Phone (WhatsApp) <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="tel"
                        className="form-input mono"
                        placeholder="+91 98765 43210"
                        value={primaryPhone}
                        onChange={(e) => setPrimaryPhone(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Alternate Phone (Optional)
                      </label>
                      <input
                        type="tel"
                        className="form-input mono"
                        placeholder="+91 98111 22233"
                        value={alternatePhone}
                        onChange={(e) => setAlternatePhone(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Collection Area / Route <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Enter area or route manually (e.g. Dadri, Alpha 1, Pari Chowk, Kasna)..."
                        value={areaRoute}
                        onChange={(e) => setAreaRoute(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Shop / Street Address Line 1 <span style={{ color: 'var(--danger)' }}>*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Shop No. 14, Main Road Market"
                      value={addressLine1}
                      onChange={(e) => setAddressLine1(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>City</label>
                      <input type="text" className="form-input" value={city} onChange={(e) => setCity(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>State</label>
                      <input type="text" className="form-input" value={state} onChange={(e) => setState(e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Pincode <span style={{ color: 'var(--danger)' }}>*</span></label>
                      <input type="text" className="form-input mono" value={pincode} onChange={(e) => setPincode(e.target.value)} />
                    </div>
                  </div>

                  <div style={{ marginTop: 6 }}>
                    <MediaUploader
                      label="Customer Main Photo / Avatar"
                      category="CUSTOMER_PHOTO"
                      helperText="Capture customer live photo or selfie with camera"
                      onChange={setCustomerPhoto}
                    />
                  </div>
                </div>
              )}

              {/* STEP 2: KYC Documents (Dynamic list with NO artificial limit) */}
              {currentStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <DynamicAttachmentManager
                    title="KYC & Identity Documents (Dynamic List)"
                    helperText="Upload as many identity and address documents as needed (Aadhaar, PAN, Voter ID, Agreement, etc.) with no count restriction."
                    type="DOCUMENT"
                    attachments={kycAttachments}
                    onChange={setKycAttachments}
                  />
                </div>
              )}

              {/* STEP 3: Product / Device Information & Photos (NO artificial limit) */}
              {currentStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Originating Partner Dealer / Store */}
                  {isDealer && (
                    <div
                      style={{
                        padding: 14,
                        background: 'var(--bg-surface-secondary)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <Store size={16} color="var(--primary)" />
                        <label style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
                          Originating Partner Retail Store
                        </label>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {dealers.find((d) => d.id === currentUser?.dealerId)?.storeName || 'Your Store'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--success-text)', marginTop: 4, fontWeight: 600 }}>
                        ✓ Automatically associated with your authenticated partner store origin.
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Financed Product Category
                      </label>
                      <select
                        className="form-select"
                        value={productType}
                        onChange={(e) => setProductType(e.target.value)}
                      >
                        <option value="Mobile Phone">Mobile Phone / Smartphone</option>
                        <option value="Tablet / Laptop">Tablet / Laptop</option>
                        <option value="Consumer Electronics">Consumer Electronics</option>
                        <option value="Two Wheeler">Two-Wheeler</option>
                        <option value="Other Appliance">Home Appliance</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Brand / Make <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Samsung, Apple, Vivo"
                        value={productBrand}
                        onChange={(e) => setProductBrand(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Model Name / Number <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Galaxy S23 128GB"
                        value={productModel}
                        onChange={(e) => setProductModel(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        IMEI 1 / Primary Device ID
                      </label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="15-digit IMEI number"
                        value={imeiNumber}
                        onChange={(e) => setImeiNumber(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Serial Number / Asset Tag
                      </label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="Device serial number"
                        value={serialNumber}
                        onChange={(e) => setSerialNumber(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Retail Cash Price (₹) <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <input
                        type="number"
                        className="form-input mono"
                        value={productPrice}
                        onChange={(e) => setProductPrice(Number(e.target.value))}
                        onBlur={(e) => setProductPrice(Number(normalizeNumericLeadingZeros(e.target.value) || 0))}
                        required
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Invoice / Bill Number
                      </label>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="INV-2026-09"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Invoice Date
                      </label>
                      <input
                        type="date"
                        className="form-input"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Dynamic Product/Device Photos */}
                  <div style={{ marginTop: 8 }}>
                    <DynamicAttachmentManager
                      title="Product & Device Evidence Photos (Dynamic Gallery)"
                      helperText="Attach multiple device angles, IMEI sticker photos, box photos, and invoice proofs without any count limit."
                      type="PHOTO"
                      attachments={productAttachments}
                      onChange={setProductAttachments}
                    />
                  </div>
                </div>
              )}

              {/* STEP 4: EMI Terms & Server Calculation */}
              {currentStep === 4 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Retail Price (₹)
                      </label>
                      <input type="number" className="form-input mono" value={productPrice} disabled />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Down Payment Collected (₹)
                      </label>
                      <input
                        type="number"
                        className="form-input mono"
                        value={downPayment}
                        onChange={(e) => setDownPayment(Number(e.target.value))}
                        onBlur={(e) => setDownPayment(Number(normalizeNumericLeadingZeros(e.target.value) || 0))}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Financed Principal (₹)
                      </label>
                      <div
                        className="mono"
                        style={{
                          padding: '8px 12px',
                          background: 'var(--bg-surface-secondary)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-subtle)',
                          fontWeight: 700,
                          fontSize: 14,
                          color: 'var(--primary)',
                        }}
                      >
                        {formatINR(Math.max(0, productPrice - downPayment))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        Loan Origination Date (DD/MM/YYYY) <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="form-input mono"
                          placeholder="DD/MM/YYYY"
                          value={disbDisplay}
                          onChange={(e) => handleDisbDisplayChange(e.target.value)}
                          onBlur={() => {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(disbursementDate)) {
                              setDisbDisplay(formatDateDDMMYYYY(disbursementDate));
                            }
                          }}
                          required
                          style={{ paddingRight: 36 }}
                        />
                        <input
                          type="date"
                          value={disbursementDate}
                          onChange={(e) => {
                            if (e.target.value) {
                              setDisbursementDate(e.target.value);
                              setDisbDisplay(formatDateDDMMYYYY(e.target.value));
                            }
                          }}
                          tabIndex={-1}
                          aria-label="Select Origination Date"
                          style={{
                            position: 'absolute',
                            right: 8,
                            width: 24,
                            height: 24,
                            opacity: 0,
                            cursor: 'pointer',
                            zIndex: 2,
                          }}
                        />
                        <Calendar
                          size={16}
                          style={{
                            position: 'absolute',
                            right: 10,
                            color: 'var(--text-muted)',
                            pointerEvents: 'none',
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        EMI Start Date (DD/MM/YYYY) <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="form-input mono"
                          placeholder="DD/MM/YYYY"
                          value={firstEmiDisplay}
                          onChange={(e) => handleFirstEmiDisplayChange(e.target.value)}
                          onBlur={() => {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(firstEmiDate)) {
                              setFirstEmiDisplay(formatDateDDMMYYYY(firstEmiDate));
                            }
                          }}
                          required
                          style={{ paddingRight: 36 }}
                        />
                        <input
                          type="date"
                          value={firstEmiDate}
                          onChange={(e) => {
                            if (e.target.value) {
                              setFirstEmiDate(e.target.value);
                              setFirstEmiDisplay(formatDateDDMMYYYY(e.target.value));
                            }
                          }}
                          tabIndex={-1}
                          aria-label="Select EMI Start Date"
                          style={{
                            position: 'absolute',
                            right: 8,
                            width: 24,
                            height: 24,
                            opacity: 0,
                            cursor: 'pointer',
                            zIndex: 2,
                          }}
                        />
                        <Calendar
                          size={16}
                          style={{
                            position: 'absolute',
                            right: 10,
                            color: 'var(--text-muted)',
                            pointerEvents: 'none',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Select the date when the first EMI becomes due.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                        EMI Tenure <span style={{ color: 'var(--danger)' }}>*</span>
                      </label>
                      <select
                        className="form-select"
                        value={tenureMonths}
                        onChange={(e) => setTenureMonths(Number(e.target.value))}
                        required
                      >
                        <option value={3}>3 Months</option>
                        <option value={6}>6 Months</option>
                        <option value={9}>9 Months</option>
                        <option value={12}>12 Months</option>
                        <option value={18}>18 Months</option>
                        <option value={24}>24 Months</option>
                      </select>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Number of installments.
                      </div>
                    </div>

                    <div
                      style={{
                        background: 'var(--bg-surface-secondary)',
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 12,
                        }}
                      >
                        <div>
                          <label style={{ fontSize: 13, fontWeight: 700, display: 'block', color: 'var(--text-primary)' }}>
                            Interest Rate (Monthly Flat Simple Interest) <span style={{ color: 'var(--danger)' }}>*</span>
                          </label>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Select one of the approved monthly flat interest rates (4%, 5%, or 6%).
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span className="badge badge-info" style={{ fontSize: 11, padding: '4px 8px' }}>
                            Method: Flat Rate
                          </span>
                          <span className="badge badge-secondary" style={{ fontSize: 11, padding: '4px 8px' }}>
                            Frequency: Monthly
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 12,
                        }}
                      >
                        {ALLOWED_MONTHLY_INTEREST_RATES.map((rate) => {
                          const isSelected = Number(annualRate) === rate;
                          return (
                            <button
                              key={rate}
                              type="button"
                              onClick={() => setAnnualRate(rate)}
                              style={{
                                padding: '14px 12px',
                                borderRadius: 'var(--radius-md)',
                                border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-default)',
                                background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-surface)',
                                cursor: 'pointer',
                                textAlign: 'center',
                                position: 'relative',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {isSelected && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: 6,
                                    right: 8,
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    background: 'var(--primary)',
                                  }}
                                />
                              )}
                              <div
                                className="mono"
                                style={{
                                  fontSize: 22,
                                  fontWeight: 800,
                                  color: isSelected ? 'var(--primary)' : 'var(--text-primary)',
                                  lineHeight: 1.2,
                                }}
                              >
                                {rate}%
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: isSelected ? 'var(--primary)' : 'var(--text-secondary)',
                                  marginTop: 4,
                                }}
                              >
                                per month (flat)
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Authoritative amortization schedule is calculated directly on the server financial engine.
                    </span>
                    <button
                      type="button"
                      onClick={handleFetchPreview}
                      disabled={calculatingPreview}
                      className="btn btn-secondary btn-sm"
                    >
                      <Calculator size={13} />
                      <span>{calculatingPreview ? 'Calculating...' : 'Recalculate Preview'}</span>
                    </button>
                  </div>

                  {/* Server Calculation Preview Card */}
                  {previewSchedule && (
                    <div
                      style={{
                        background: 'var(--bg-surface-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: 16,
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, textAlign: 'center', marginBottom: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>MONTHLY EMI</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--success)' }}>
                            {formatINR(previewSchedule.emiAmount)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL INTEREST</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>
                            {formatINR(previewSchedule.totalInterest)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>TOTAL PAYABLE</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>
                            {formatINR(previewSchedule.totalPayable)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>NET FINANCED</div>
                          <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>
                            {formatINR(previewSchedule.netDisbursedAmount)}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, textAlign: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI START DATE</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>
                            {formatDateDDMMYYYY(previewSchedule.firstEmiDate)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>EMI TENURE</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                            {previewSchedule.tenureMonths} Mos ({previewSchedule.totalInstallments} EMIs)
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>FIRST EMI DUE</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                            {formatDateDDMMYYYY(previewSchedule.schedule[0]?.dueDate || previewSchedule.firstEmiDate)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LAST EMI DUE</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                            {formatDateDDMMYYYY(previewSchedule.maturityDate)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 5: Review & Confirm */}
              {currentStep === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* Customer Summary */}
                    <div
                      style={{
                        padding: 14,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        background: '#ffffff',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
                        1. BORROWER PROFILE
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{fullName}</div>
                      <div className="mono" style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {primaryPhone}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {addressLine1}, {city}, {state} - {pincode}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, marginTop: 4 }}>
                        Route / Area: <span style={{ color: 'var(--primary)' }}>{areaRoute}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {kycAttachments.filter((k) => k.file).length} KYC Documents Attached
                      </div>
                    </div>

                    {/* Financed Product Summary */}
                    <div
                      style={{
                        padding: 14,
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        background: '#ffffff',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
                        2. FINANCED PRODUCT / DEVICE
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {productBrand} {productModel}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Category: {productType}
                      </div>
                      {imeiNumber && (
                        <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                          IMEI: {imeiNumber}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Invoice Price: <span className="mono" style={{ fontWeight: 600 }}>{formatINR(productPrice)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {productAttachments.filter((p) => p.file).length} Product Photos Attached
                      </div>
                    </div>
                  </div>

                  {/* Financial Terms Summary */}
                  {previewSchedule && (
                    <div
                      style={{
                        padding: 16,
                        border: '1px solid var(--primary-border)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--primary-subtle)',
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8 }}>
                        3. APPROVED FINANCING & EMI TERMS
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Financed Amount</div>
                          <div className="mono" style={{ fontSize: 16, fontWeight: 800 }}>
                            {formatINR(productPrice - downPayment)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Down Payment</div>
                          <div className="mono" style={{ fontSize: 16, fontWeight: 800 }}>
                            {formatINR(downPayment)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Monthly Installment</div>
                          <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--success)' }}>
                            {formatINR(previewSchedule.emiAmount)}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Tenure & Schedule</div>
                          <div className="mono" style={{ fontSize: 14, fontWeight: 800 }}>
                            {previewSchedule.totalInstallments} EMIs (Starts {formatDateDDMMYYYY(previewSchedule.firstEmiDate)})
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Navigation Buttons */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={currentStep === 1 ? handleClose : handlePrev}
                className="btn btn-secondary"
              >
                {currentStep === 1 ? (
                  'Cancel'
                ) : (
                  <>
                    <ChevronLeft size={15} />
                    <span>Back</span>
                  </>
                )}
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                {currentStep < 5 ? (
                  <button type="button" onClick={handleNext} className="btn btn-primary">
                    <span>Continue to Step {currentStep + 1}</span>
                    <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFinalSubmit}
                    disabled={submitting}
                    className="btn btn-primary btn-lg"
                  >
                    {submitting ? 'Creating Customer & Booking Loan...' : 'Confirm & Create Customer'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
