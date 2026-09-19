-- =========================================================================
-- MIGRATION 002: Users last_login_at & Customer Search Index
-- =========================================================================

-- 1. Add last_login_at to users table if not exists
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 2. Add search indexes for customer full_name (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_customers_name_lower ON customers(LOWER(full_name));

-- 3. Add composite index for agent assignment lookups
CREATE INDEX IF NOT EXISTS idx_assignments_agent_active ON collection_assignments(agent_id, customer_id, is_active);
