-- Migration 017: Add rejection_reason and approval_notes to loans table
ALTER TABLE loans ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS approval_notes TEXT;
