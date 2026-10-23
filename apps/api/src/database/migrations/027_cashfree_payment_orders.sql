-- =========================================================================
-- Migration 027: Cashfree Payment Gateway Orders and Webhook Audit
-- =========================================================================

CREATE TABLE IF NOT EXISTS cashfree_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(64) UNIQUE NOT NULL,
    payment_session_id TEXT,
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    emi_installment_id UUID REFERENCES emi_installments(id) ON DELETE RESTRICT,
    installment_number INTEGER,
    order_amount NUMERIC(12, 2) NOT NULL,
    order_currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAID', 'FAILED', 'USER_DROPPED', 'EXPIRED', 'CANCELLED'
    cf_payment_id VARCHAR(64),
    payment_time TIMESTAMPTZ,
    payment_method VARCHAR(64),
    bank_reference VARCHAR(64),
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_orders_loan ON cashfree_orders(loan_id);
CREATE INDEX IF NOT EXISTS idx_cf_orders_customer ON cashfree_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_cf_orders_order_id ON cashfree_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_cf_orders_status ON cashfree_orders(status);
CREATE INDEX IF NOT EXISTS idx_cf_orders_cf_payment_id ON cashfree_orders(cf_payment_id);
CREATE INDEX IF NOT EXISTS idx_cf_orders_created_at ON cashfree_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS cashfree_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id VARCHAR(128) UNIQUE NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    order_id VARCHAR(64),
    cf_payment_id VARCHAR(64),
    raw_payload JSONB,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cf_webhook_events_order_id ON cashfree_webhook_events(order_id);
CREATE INDEX IF NOT EXISTS idx_cf_webhook_events_cf_payment_id ON cashfree_webhook_events(cf_payment_id);
