-- Migration 018: Add loan_id to collection_assignments for specific loan recovery assignment
ALTER TABLE collection_assignments ADD COLUMN IF NOT EXISTS loan_id UUID REFERENCES loans(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_assignments_loan_active ON collection_assignments(loan_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_loan_assignment ON collection_assignments(loan_id) WHERE is_active = TRUE AND loan_id IS NOT NULL;
