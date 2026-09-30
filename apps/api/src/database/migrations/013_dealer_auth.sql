-- ===================================================
-- Migration 013: Production Dealer Authentication & RBAC
-- ===================================================

-- 1. Ensure 'DEALER' is in user_role enum
DO $$ BEGIN
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'DEALER';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add dealer_id and must_change_password to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES dealers(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Make users.phone optional for dealer users
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_not_null ON users(phone) WHERE phone IS NOT NULL AND phone != '';

-- 4. Ensure 1:1 relationship: one user account per dealer
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_dealer_id ON users(dealer_id) WHERE dealer_id IS NOT NULL;

-- 5. Add user_id reference to dealers table for bi-directional lookup
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dealers_user_id ON dealers(user_id) WHERE user_id IS NOT NULL;
