-- ===================================================
-- Migration 006: Dealer & Mobile Store Management
-- ===================================================

-- 1. Create Dealers Table
CREATE TABLE IF NOT EXISTS dealers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dealer_code VARCHAR(50) UNIQUE NOT NULL,
    store_name VARCHAR(150) NOT NULL,
    owner_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    alternate_phone VARCHAR(20),
    email VARCHAR(255),
    address TEXT NOT NULL,
    area_city VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'INACTIVE'
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance & search
CREATE INDEX IF NOT EXISTS idx_dealers_code ON dealers(dealer_code);
CREATE INDEX IF NOT EXISTS idx_dealers_status ON dealers(status);
CREATE INDEX IF NOT EXISTS idx_dealers_phone ON dealers(phone);
CREATE INDEX IF NOT EXISTS idx_dealers_area ON dealers(area_city);

-- 2. Link Dealer to Loans
ALTER TABLE loans ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES dealers(id);
CREATE INDEX IF NOT EXISTS idx_loans_dealer ON loans(dealer_id);
