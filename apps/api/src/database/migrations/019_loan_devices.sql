-- Migration 019: Add Device / Financed Item Context to Loans
ALTER TABLE loans ADD COLUMN IF NOT EXISTS device_brand TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS device_model TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS imei1 TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS imei2 TEXT;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS device_status TEXT DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_loans_imei1 ON loans(imei1);
CREATE INDEX IF NOT EXISTS idx_loans_device_brand ON loans(device_brand);
