-- Migration 022: Add penalty_amount column to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00;
