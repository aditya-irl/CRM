-- ===================================================
-- Migration 012: Dedicated Customer Portal Tokens
-- ===================================================

CREATE TABLE IF NOT EXISTS customer_portal_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_portal_tokens_hash ON customer_portal_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_loan ON customer_portal_tokens(loan_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer ON customer_portal_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_active ON customer_portal_tokens(is_active);
