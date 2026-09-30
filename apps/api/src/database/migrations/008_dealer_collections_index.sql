-- ===================================================
-- Migration 008: Dealer Collection Ledger Indexing
-- ===================================================

-- Composite index for optimal performance when querying dealer collection ledger and summaries
CREATE INDEX IF NOT EXISTS idx_payments_dealer_source_date 
ON payments(collection_source, dealer_id, payment_timestamp);
