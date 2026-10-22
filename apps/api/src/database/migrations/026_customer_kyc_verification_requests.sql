-- =========================================================================
-- Migration 026: Customer Portal KYC Self-Verification & Correction Requests
-- =========================================================================

-- 1. Table for tracking customer-level overall verification state
CREATE TABLE IF NOT EXISTS customer_kyc_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    loan_id UUID REFERENCES loans(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'NOT_REVIEWED'
        CHECK (status IN ('NOT_REVIEWED', 'CONFIRMED', 'CORRECTION_REQUESTED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
    confirmed_at TIMESTAMPTZ,
    last_reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_kyc_verifications_customer UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cust_kyc_verif_customer ON customer_kyc_verifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_kyc_verif_status ON customer_kyc_verifications(status);

-- 2. Table for tracking specific section confirmations & correction issue reports
CREATE TABLE IF NOT EXISTS customer_kyc_correction_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    loan_id UUID REFERENCES loans(id) ON DELETE SET NULL,
    portal_token_id UUID REFERENCES customer_portal_tokens(id) ON DELETE SET NULL,
    request_type VARCHAR(50) NOT NULL DEFAULT 'CORRECTION_REQUEST'
        CHECK (request_type IN ('CONFIRMATION', 'CORRECTION_REQUEST')),
    section VARCHAR(100) NOT NULL
        CHECK (section IN ('PERSONAL_DETAILS', 'CONTACT_DETAILS', 'ADDRESS', 'IDENTITY_DOCUMENTS', 'PHOTOGRAPH', 'ALL', 'OTHER')),
    explanation TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED')),
    resolution_notes TEXT,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_corr_req_customer ON customer_kyc_correction_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_corr_req_status ON customer_kyc_correction_requests(status);
CREATE INDEX IF NOT EXISTS idx_corr_req_created_at ON customer_kyc_correction_requests(created_at DESC);
