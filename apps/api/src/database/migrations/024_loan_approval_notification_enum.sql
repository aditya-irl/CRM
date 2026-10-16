-- =========================================================================
-- Migration 024: Ensure LOAN_APPROVED & Loan Lifecycle Notification Enums
-- =========================================================================

-- Safely ensures all loan lifecycle notification types exist in PostgreSQL
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_REJECTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_DISBURSED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DEALER_PAYMENT_RECORDED';
