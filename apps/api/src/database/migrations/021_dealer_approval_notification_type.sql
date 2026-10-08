-- Migration 021: Add DEALER_APPROVAL_REQUIRED to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'DEALER_APPROVAL_REQUIRED';
