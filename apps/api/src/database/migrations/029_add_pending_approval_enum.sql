-- Migration 029: Add PENDING_APPROVAL to payment_status enum
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
