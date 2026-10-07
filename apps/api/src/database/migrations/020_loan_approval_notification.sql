-- Migration 020: Add LOAN_APPROVAL_REQUEST to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LOAN_APPROVAL_REQUEST';
