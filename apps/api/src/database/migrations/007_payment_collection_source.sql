-- ===================================================
-- Migration 007: Payment Collection Source
-- ===================================================

-- 1. Add collection_source, dealer_id, and agent_id columns to payments table
ALTER TABLE payments 
ADD COLUMN IF NOT EXISTS collection_source VARCHAR(30) NOT NULL DEFAULT 'DIRECT_CUSTOMER',
ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES dealers(id) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES users(id) ON DELETE RESTRICT;

-- 2. Indexes for collection source filtering and dealer/agent reporting
CREATE INDEX IF NOT EXISTS idx_payments_collection_source ON payments(collection_source);
CREATE INDEX IF NOT EXISTS idx_payments_dealer_id ON payments(dealer_id);
CREATE INDEX IF NOT EXISTS idx_payments_agent_id ON payments(agent_id);
