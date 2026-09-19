-- ===================================================
-- Migration 003: Phase 2 Loan Lifecycle, Constraints & Indexes
-- ===================================================

DO $$ BEGIN
    ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'APPROVED';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE loan_status ADD VALUE IF NOT EXISTS 'REJECTED';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Fix loan total_payable constraint when down_payment > 0: total_payable must be >= net_disbursed_amount
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_check;
ALTER TABLE loans DROP CONSTRAINT IF EXISTS chk_loans_total_payable;
ALTER TABLE loans ADD CONSTRAINT chk_loans_total_payable CHECK (total_payable >= net_disbursed_amount);

-- Compound index for agent portfolio loan queries
CREATE INDEX IF NOT EXISTS idx_loans_agent_status ON loans(assigned_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_loans_customer_status ON loans(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_emi_loan_installment ON emi_installments(loan_id, installment_number);
