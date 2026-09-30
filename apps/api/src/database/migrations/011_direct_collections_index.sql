-- ===================================================
-- Migration 011: Direct Customer Collection Ledger Indexing
-- ===================================================

-- Composite index for high-performance direct customer collection queries and reporting
CREATE INDEX IF NOT EXISTS idx_payments_direct_source_date 
ON payments(collection_source, payment_timestamp) 
WHERE collection_source = 'DIRECT_CUSTOMER';
