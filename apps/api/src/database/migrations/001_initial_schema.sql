-- =========================================================================
-- MIGRATION 001: Initial PostgreSQL Financial Schema & Immutable Audit
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ENUMS
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'COLLECTION_AGENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE user_status AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE kyc_type AS ENUM ('AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENSE', 'LOAN_AGREEMENT', 'PHOTO', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE kyc_status AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE interest_method AS ENUM ('FLAT_RATE', 'REDUCING_BALANCE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE repayment_frequency AS ENUM ('DAILY', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE loan_status AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'DEFAULTED', 'RESTRUCTURED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE emi_status AS ENUM ('UPCOMING', 'DUE_TODAY', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_mode AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('SUCCESS', 'PENDING_VERIFICATION', 'REVERSED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE call_outcome AS ENUM (
        'PROMISED_TO_PAY', 'UNREACHABLE', 'RINGING', 'SWITCHED_OFF', 
        'WRONG_NUMBER', 'PAID', 'REFUSED_TO_PAY', 'DISPUTE', 'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM ('WHATSAPP', 'SMS', 'PUSH', 'IN_APP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'REMINDER_T_MINUS_7', 'REMINDER_T_MINUS_3', 'REMINDER_T_MINUS_1', 
        'DUE_TODAY', 'OVERDUE', 'PAYMENT_RECEIPT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. USERS
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role user_role NOT NULL DEFAULT 'COLLECTION_AGENT',
    status user_status NOT NULL DEFAULT 'ACTIVE',
    assigned_branch VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

-- 3. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_code VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    primary_phone VARCHAR(20) NOT NULL,
    alternate_phone VARCHAR(20),
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    landmark VARCHAR(150),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    area_route VARCHAR(100) NOT NULL,
    photo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(primary_phone);
CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area_route);

-- 4. KYC DOCUMENTS
CREATE TABLE IF NOT EXISTS kyc_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    doc_type kyc_type NOT NULL,
    doc_number_masked VARCHAR(50),
    doc_number_hash VARCHAR(128),
    storage_key TEXT NOT NULL,
    file_mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    status kyc_status NOT NULL DEFAULT 'PENDING',
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kyc_customer ON kyc_documents(customer_id);

-- 5. LOANS
CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_account_no VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    principal_amount NUMERIC(14,2) NOT NULL CHECK (principal_amount > 0),
    down_payment NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (down_payment >= 0),
    net_disbursed_amount NUMERIC(14,2) NOT NULL CHECK (net_disbursed_amount > 0),
    annual_interest_rate NUMERIC(6,4) NOT NULL CHECK (annual_interest_rate >= 0),
    interest_calc_method interest_method NOT NULL DEFAULT 'FLAT_RATE',
    tenure_months INT NOT NULL CHECK (tenure_months > 0),
    installment_frequency repayment_frequency NOT NULL DEFAULT 'MONTHLY',
    total_installments INT NOT NULL CHECK (total_installments > 0),
    emi_amount NUMERIC(14,2) NOT NULL CHECK (emi_amount > 0),
    total_interest NUMERIC(14,2) NOT NULL CHECK (total_interest >= 0),
    total_payable NUMERIC(14,2) NOT NULL CHECK (total_payable >= principal_amount),
    total_paid NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_paid >= 0),
    outstanding_balance NUMERIC(14,2) NOT NULL CHECK (outstanding_balance >= 0),
    disbursement_date DATE NOT NULL,
    first_emi_date DATE NOT NULL,
    maturity_date DATE NOT NULL,
    assigned_agent_id UUID REFERENCES users(id),
    status loan_status NOT NULL DEFAULT 'ACTIVE',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loans_customer ON loans(customer_id);
CREATE INDEX IF NOT EXISTS idx_loans_agent ON loans(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_acc_no ON loans(loan_account_no);

-- 6. EMI AMORTIZATION SCHEDULE
CREATE TABLE IF NOT EXISTS emi_installments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    installment_number INT NOT NULL CHECK (installment_number > 0),
    due_date DATE NOT NULL,
    principal_component NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    interest_component NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    expected_amount NUMERIC(14,2) NOT NULL CHECK (expected_amount > 0),
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC(14,2) NOT NULL CHECK (remaining_amount >= 0),
    penalty_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (penalty_amount >= 0),
    status emi_status NOT NULL DEFAULT 'UPCOMING',
    days_overdue INT NOT NULL DEFAULT 0 CHECK (days_overdue >= 0),
    last_payment_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_loan_installment UNIQUE (loan_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_emi_loan_id ON emi_installments(loan_id);
CREATE INDEX IF NOT EXISTS idx_emi_customer_status ON emi_installments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_emi_due_date_status ON emi_installments(due_date, status);
CREATE INDEX IF NOT EXISTS idx_emi_status ON emi_installments(status);

-- 7. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    emi_id UUID REFERENCES emi_installments(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    payment_mode payment_mode NOT NULL DEFAULT 'CASH',
    reference_number VARCHAR(100),
    collected_by_agent_id UUID NOT NULL REFERENCES users(id),
    payment_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status payment_status NOT NULL DEFAULT 'SUCCESS',
    notes TEXT,
    is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
    reversed_payment_id UUID REFERENCES payments(id),
    reversal_reason TEXT,
    idempotency_key VARCHAR(150) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_loan ON payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_emi ON payments(emi_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent_date ON payments(collected_by_agent_id, payment_timestamp);
CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_number);

-- 8. CALL LOGS
CREATE TABLE IF NOT EXISTS call_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    loan_id UUID REFERENCES loans(id) ON DELETE RESTRICT,
    emi_id UUID REFERENCES emi_installments(id) ON DELETE RESTRICT,
    agent_id UUID NOT NULL REFERENCES users(id),
    call_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    outcome call_outcome NOT NULL,
    promised_payment_date DATE,
    next_follow_up_date DATE,
    notes TEXT NOT NULL,
    contact_phone_used VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_logs_customer ON call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_agent ON call_logs(agent_id, call_timestamp);
CREATE INDEX IF NOT EXISTS idx_call_logs_follow_up ON call_logs(next_follow_up_date);

-- 9. COLLECTION ASSIGNMENTS
CREATE TABLE IF NOT EXISTS collection_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    area_route VARCHAR(100),
    assigned_by UUID NOT NULL REFERENCES users(id),
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assignments_agent ON collection_assignments(agent_id, is_active);
CREATE INDEX IF NOT EXISTS idx_assignments_area ON collection_assignments(area_route, is_active);

-- 10. IMMUTABLE AUDIT LOGS
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_date ON audit_logs(user_id, created_at);

-- 11. AUDIT IMMUTABILITY TRIGGER (Strict Database-Level Protection)
CREATE OR REPLACE FUNCTION prevent_audit_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are strictly immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_audit_logs ON audit_logs;
CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_tampering();

-- 12. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_customer_id UUID REFERENCES customers(id),
    recipient_user_id UUID REFERENCES users(id),
    channel notification_channel NOT NULL,
    type notification_type NOT NULL,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    status notification_status NOT NULL DEFAULT 'PENDING',
    idempotency_key VARCHAR(150) UNIQUE,
    scheduled_for TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status, scheduled_for);

-- 13. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
