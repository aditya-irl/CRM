-- Migration 028: Add indexes for payment approval workflow and EMI status lookups
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_emi_id ON payments(emi_id);
CREATE INDEX IF NOT EXISTS idx_payments_emi_status ON payments(emi_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_agent_status ON payments(agent_id, status);
