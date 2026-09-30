-- CRM Financial Schema (SQLite & PostgreSQL Compatible DDL)

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'COLLECTION_AGENT', -- 'SUPER_ADMIN', 'ADMIN', 'BRANCH_MANAGER', 'COLLECTION_AGENT'
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE', 'SUSPENDED'
    assigned_branch TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    customer_code TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    primary_phone TEXT NOT NULL,
    alternate_phone TEXT,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    landmark TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    pincode TEXT NOT NULL,
    area_route TEXT NOT NULL,
    photo_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(customer_code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(primary_phone);
CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area_route);

CREATE TABLE IF NOT EXISTS kyc_documents (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    doc_type TEXT NOT NULL, -- 'AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENSE', 'LOAN_AGREEMENT', 'PHOTO', 'OTHER'
    doc_number_masked TEXT,
    doc_number_hash TEXT,
    storage_key TEXT NOT NULL,
    file_mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'VERIFIED', 'REJECTED'
    verified_by TEXT REFERENCES users(id),
    verified_at TEXT,
    rejection_reason TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kyc_customer ON kyc_documents(customer_id);

CREATE TABLE IF NOT EXISTS dealers (
    id TEXT PRIMARY KEY,
    dealer_code TEXT UNIQUE NOT NULL,
    store_name TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    alternate_phone TEXT,
    email TEXT,
    address TEXT NOT NULL,
    area_city TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE'
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dealers_code ON dealers(dealer_code);
CREATE INDEX IF NOT EXISTS idx_dealers_status ON dealers(status);
CREATE INDEX IF NOT EXISTS idx_dealers_phone ON dealers(phone);

CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    loan_account_no TEXT UNIQUE NOT NULL,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    dealer_id TEXT REFERENCES dealers(id),
    principal_amount REAL NOT NULL,
    down_payment REAL NOT NULL DEFAULT 0.0,
    net_disbursed_amount REAL NOT NULL,
    annual_interest_rate REAL NOT NULL,
    interest_calc_method TEXT NOT NULL DEFAULT 'FLAT_RATE',
    tenure_months INTEGER NOT NULL,
    installment_frequency TEXT NOT NULL DEFAULT 'MONTHLY',
    total_installments INTEGER NOT NULL,
    emi_amount REAL NOT NULL,
    total_interest REAL NOT NULL,
    total_payable REAL NOT NULL,
    total_paid REAL NOT NULL DEFAULT 0.0,
    outstanding_balance REAL NOT NULL,
    disbursement_date TEXT NOT NULL,
    first_emi_date TEXT NOT NULL,
    maturity_date TEXT NOT NULL,
    assigned_agent_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'DEFAULTED'
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loans_customer ON loans(customer_id);
CREATE INDEX IF NOT EXISTS idx_loans_dealer ON loans(dealer_id);
CREATE INDEX IF NOT EXISTS idx_loans_agent ON loans(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_acc_no ON loans(loan_account_no);

CREATE TABLE IF NOT EXISTS emi_installments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    installment_number INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    principal_component REAL NOT NULL DEFAULT 0.0,
    interest_component REAL NOT NULL DEFAULT 0.0,
    expected_amount REAL NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0.0,
    remaining_amount REAL NOT NULL,
    penalty_amount REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'UPCOMING', -- 'UPCOMING', 'DUE_TODAY', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'
    days_overdue INTEGER NOT NULL DEFAULT 0,
    last_payment_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(loan_id, installment_number)
);
CREATE INDEX IF NOT EXISTS idx_emi_loan_id ON emi_installments(loan_id);
CREATE INDEX IF NOT EXISTS idx_emi_customer_status ON emi_installments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_emi_due_date_status ON emi_installments(due_date, status);
CREATE INDEX IF NOT EXISTS idx_emi_status ON emi_installments(status);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    receipt_number TEXT UNIQUE NOT NULL,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    emi_id TEXT REFERENCES emi_installments(id) ON DELETE RESTRICT,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount REAL NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'CASH', -- 'CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'
    collection_source TEXT NOT NULL DEFAULT 'DIRECT_CUSTOMER', -- 'DIRECT_CUSTOMER', 'DEALER', 'RECOVERY_AGENT'
    dealer_id TEXT REFERENCES dealers(id),
    agent_id TEXT REFERENCES users(id),
    reference_number TEXT,
    collected_by_agent_id TEXT NOT NULL REFERENCES users(id),
    payment_timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'PENDING_VERIFICATION', 'REVERSED', 'REJECTED'
    notes TEXT,
    is_reversal INTEGER NOT NULL DEFAULT 0,
    reversed_payment_id TEXT REFERENCES payments(id),
    reversal_reason TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_loan ON payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent ON payments(collected_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_receipt ON payments(receipt_number);
CREATE INDEX IF NOT EXISTS idx_payments_collection_source ON payments(collection_source);
CREATE INDEX IF NOT EXISTS idx_payments_dealer_id ON payments(dealer_id);
CREATE INDEX IF NOT EXISTS idx_payments_dealer_source_date ON payments(collection_source, dealer_id, payment_timestamp);

CREATE TABLE IF NOT EXISTS call_logs (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    loan_id TEXT REFERENCES loans(id) ON DELETE RESTRICT,
    emi_id TEXT REFERENCES emi_installments(id) ON DELETE RESTRICT,
    agent_id TEXT NOT NULL REFERENCES users(id),
    call_timestamp TEXT NOT NULL,
    outcome TEXT NOT NULL,
    promised_payment_date TEXT,
    next_follow_up_date TEXT,
    notes TEXT NOT NULL,
    contact_phone_used TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_call_logs_customer ON call_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_agent ON call_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_follow_up ON call_logs(next_follow_up_date);

CREATE TABLE IF NOT EXISTS collection_assignments (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
    area_route TEXT,
    assigned_by TEXT NOT NULL REFERENCES users(id),
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_agent ON collection_assignments(agent_id, is_active);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    previous_state TEXT, -- JSON string
    new_state TEXT,      -- JSON string
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_customer_id TEXT REFERENCES customers(id),
    recipient_user_id TEXT REFERENCES users(id),
    channel TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    idempotency_key TEXT UNIQUE,
    scheduled_for TEXT NOT NULL,
    sent_at TEXT,
    error_message TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dealer_settlements (
    id TEXT PRIMARY KEY,
    settlement_number TEXT UNIQUE NOT NULL,
    dealer_id TEXT NOT NULL REFERENCES dealers(id) ON DELETE RESTRICT,
    amount REAL NOT NULL,
    settlement_date TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    reference_number TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    is_reversal INTEGER NOT NULL DEFAULT 0,
    reversal_reason TEXT,
    reversed_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_dealer_id ON dealer_settlements(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_date ON dealer_settlements(settlement_date);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_status ON dealer_settlements(status);

CREATE TABLE IF NOT EXISTS dealer_settlement_allocations (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL REFERENCES dealer_settlements(id) ON DELETE CASCADE,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    amount_allocated REAL NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_settlement_id ON dealer_settlement_allocations(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_payment_id ON dealer_settlement_allocations(payment_id);

CREATE TABLE IF NOT EXISTS customer_portal_tokens (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_hash ON customer_portal_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_loan ON customer_portal_tokens(loan_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer ON customer_portal_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_active ON customer_portal_tokens(is_active);

