-- ===================================================
-- Migration 010: Recovery Agent Collection Ledger Indexing
-- ===================================================

-- Composite index for optimal performance when querying recovery agent collection ledger and summaries
CREATE INDEX IF NOT EXISTS idx_payments_agent_source_date 
ON payments(collection_source, agent_id, payment_timestamp);
