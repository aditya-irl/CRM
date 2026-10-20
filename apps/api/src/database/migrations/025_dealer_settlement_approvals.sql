-- =========================================================================
-- Migration 025: Dealer Settlement Approval & Audit Traceability
-- =========================================================================

ALTER TABLE dealer_settlements ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE dealer_settlements ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE dealer_settlements ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id);
ALTER TABLE dealer_settlements ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dealer_settlements_approved_by ON dealer_settlements(approved_by);
CREATE INDEX IF NOT EXISTS idx_dealer_settlements_rejected_by ON dealer_settlements(rejected_by);
