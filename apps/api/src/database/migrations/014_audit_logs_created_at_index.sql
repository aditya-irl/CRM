-- ===================================================
-- Migration 014: Audit Logs Chronological Performance Index
-- ===================================================

-- Index on created_at DESC for high-performance audit trail pagination and filtering
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);
