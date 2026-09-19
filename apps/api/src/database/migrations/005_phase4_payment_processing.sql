-- Migration 005: Phase 4 Payment Processing Indexes & Performance Optimizations

-- 1. Partial index for EMI state transitions (indexes only non-paid installments)
CREATE INDEX IF NOT EXISTS idx_emi_unpaid_due_partial 
    ON emi_installments (due_date) 
    WHERE status != 'PAID';

-- 2. Compound indexes on payments for loan and customer history lookups
CREATE INDEX IF NOT EXISTS idx_payments_loan_status 
    ON payments (loan_id, status);

CREATE INDEX IF NOT EXISTS idx_payments_customer_date 
    ON payments (customer_id, payment_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_payments_reversal 
    ON payments (reversed_payment_id) 
    WHERE reversed_payment_id IS NOT NULL;
