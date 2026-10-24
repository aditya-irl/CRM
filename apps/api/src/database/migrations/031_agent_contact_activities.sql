-- Migration 031: Agent Contact Activity and Recovery Follow-up Tracking

CREATE TABLE IF NOT EXISTS customer_contact_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    loan_id UUID REFERENCES loans(id) ON DELETE SET NULL,
    emi_id UUID REFERENCES emi_installments(id) ON DELETE SET NULL,
    agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dealer_id UUID REFERENCES dealers(id) ON DELETE SET NULL,
    
    -- Contact Method
    contact_method VARCHAR(50) NOT NULL,
    contact_method_other TEXT,
    contact_phone_used VARCHAR(50),
    
    -- Contact Attempt Result / Outcome
    contact_outcome VARCHAR(60) NOT NULL,
    contact_outcome_other TEXT,
    
    -- Customer Response
    customer_response_category VARCHAR(60),
    customer_response_notes TEXT,
    
    -- Reason for Non-Payment
    non_payment_reason VARCHAR(60),
    non_payment_reason_notes TEXT,
    
    -- Payment Commitment
    promised_payment_amount NUMERIC(12, 2),
    promised_payment_date DATE,
    payment_mode_promised VARCHAR(50),
    commitment_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
    commitment_fulfilled_at TIMESTAMPTZ,
    commitment_status_notes TEXT,
    
    -- Follow-up Scheduling
    follow_up_date DATE,
    follow_up_time VARCHAR(20),
    follow_up_priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    follow_up_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
    follow_up_completed_at TIMESTAMPTZ,
    follow_up_notes TEXT,
    
    -- Agent General Notes
    agent_notes TEXT,
    
    -- Audit Tracking
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance and Filter Indexes
CREATE INDEX IF NOT EXISTS idx_cca_customer_id ON customer_contact_activities(customer_id);
CREATE INDEX IF NOT EXISTS idx_cca_loan_id ON customer_contact_activities(loan_id);
CREATE INDEX IF NOT EXISTS idx_cca_agent_created ON customer_contact_activities(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_dealer_id ON customer_contact_activities(dealer_id);
CREATE INDEX IF NOT EXISTS idx_cca_created_at ON customer_contact_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_follow_up ON customer_contact_activities(follow_up_date, follow_up_status);
CREATE INDEX IF NOT EXISTS idx_cca_commitment ON customer_contact_activities(commitment_status, promised_payment_date);
CREATE INDEX IF NOT EXISTS idx_cca_method_outcome ON customer_contact_activities(contact_method, contact_outcome);
