-- ===================================================
-- Migration 023: Dealer Payables (Company -> Dealer)
-- ===================================================

-- 1. Extend notification_type enum with approval & payout notification events
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_REJECTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_DISBURSED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DEALER_PAYMENT_RECORDED';

-- 2. Add approved_by and approved_at columns to payments for collection approval traceability
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 3. Create dealer_payable_payments table (Company payments made to Dealers for disbursed products)
CREATE TABLE IF NOT EXISTS dealer_payable_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payout_number VARCHAR(50) UNIQUE NOT NULL,
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  payment_method VARCHAR(30) NOT NULL, -- 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH'
  reference_number VARCHAR(100),
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'REVERSED'
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create dealer_payable_allocations junction table
CREATE TABLE IF NOT EXISTS dealer_payable_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payout_id UUID NOT NULL REFERENCES dealer_payable_payments(id) ON DELETE CASCADE,
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
  amount_allocated NUMERIC(15,2) NOT NULL CHECK (amount_allocated > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payout_id, loan_id)
);

-- 5. Indexes for fast retrieval, filtering, and reconciliation
CREATE INDEX IF NOT EXISTS idx_dealer_payable_payments_dealer_id ON dealer_payable_payments(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_payable_payments_date ON dealer_payable_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_dealer_payable_payments_status ON dealer_payable_payments(status);
CREATE INDEX IF NOT EXISTS idx_dealer_payable_allocations_payout_id ON dealer_payable_allocations(payout_id);
CREATE INDEX IF NOT EXISTS idx_dealer_payable_allocations_loan_id ON dealer_payable_allocations(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_approved_by ON payments(approved_by);
