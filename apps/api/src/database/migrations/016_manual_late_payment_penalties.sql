-- 016_manual_late_payment_penalties.sql
-- Manual late payment penalties for overdue EMIs and system setting for dealer permission

CREATE TABLE IF NOT EXISTS emi_penalties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    emi_installment_id UUID NOT NULL REFERENCES emi_installments(id) ON DELETE RESTRICT,
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAID', 'WAIVED', 'REVERSED')),
    reason TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reversed_by UUID REFERENCES users(id),
    reversed_at TIMESTAMPTZ,
    reversal_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_emi_penalties_emi ON emi_penalties(emi_installment_id);
CREATE INDEX IF NOT EXISTS idx_emi_penalties_loan ON emi_penalties(loan_id);
CREATE INDEX IF NOT EXISTS idx_emi_penalties_status ON emi_penalties(status);

-- Seed default ALLOW_DEALER_PENALTY setting in system_settings if not present
INSERT INTO system_settings (key, value, description, updated_at)
VALUES (
    'ALLOW_DEALER_PENALTY',
    'false'::jsonb,
    'When enabled, dealer users can manually add late-payment penalties to overdue EMIs belonging to their own customers.',
    NOW()
)
ON CONFLICT (key) DO NOTHING;
