-- ===================================================
-- Migration 009: Dealer Settlement & Reconciliation
-- ===================================================

-- 1. Create dealer_settlements table
CREATE TABLE IF NOT EXISTS dealer_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_number VARCHAR(50) UNIQUE NOT NULL,
  dealer_id UUID NOT NULL REFERENCES dealers(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  settlement_date DATE NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  reference_number VARCHAR(100),
  notes TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  reversal_reason TEXT,
  reversed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create dealer_settlement_allocations junction table
CREATE TABLE IF NOT EXISTS dealer_settlement_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id UUID NOT NULL REFERENCES dealer_settlements(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount_allocated NUMERIC(15,2) NOT NULL CHECK (amount_allocated > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indexes for fast retrieval, filtering, and reconciliation
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_dealer_id ON dealer_settlements(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_date ON dealer_settlements(settlement_date);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_status ON dealer_settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_settlement_id ON dealer_settlement_allocations(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_allocations_payment_id ON dealer_settlement_allocations(payment_id);
