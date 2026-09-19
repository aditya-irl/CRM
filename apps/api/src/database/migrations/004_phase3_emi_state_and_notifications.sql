-- ===================================================
-- Migration 004: Phase 3 EMI State Machine & Notification Indexes
-- ===================================================

-- Optimize batch queries for active unpaid installments and daily transitions
CREATE INDEX IF NOT EXISTS idx_emi_status_due_date ON emi_installments(status, due_date);
CREATE INDEX IF NOT EXISTS idx_emi_due_paid ON emi_installments(due_date, paid_amount);

-- Optimize notification scheduling and delivery worker queries
CREATE INDEX IF NOT EXISTS idx_notifications_idempotency ON notifications(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notifications_status_scheduled ON notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_customer_id, type);
