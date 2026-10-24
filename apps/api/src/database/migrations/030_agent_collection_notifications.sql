-- Migration 030: Add agent collection notification types to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AGENT_COLLECTION_APPROVAL_REQUIRED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AGENT_COLLECTION_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'AGENT_COLLECTION_REJECTED';
