import { env } from '../src/config/env';
import { getStorageProvider, MAX_KYC_URL_EXPIRY_SECONDS } from '../src/core/storage';
import { getQueue, JOB_NAMES, QUEUE_NAMES, DEFAULT_JOB_OPTIONS } from '../src/core/queue';
import { acquireDistributedLock, releaseDistributedLock } from '../src/core/redis';
import {
  BUSINESS_TIMEZONE,
  getBusinessDateStr,
  calculateDaysOverdue,
  calculateNextDueDate,
  formatDisplayDate,
  RepaymentFrequency,
} from '@crm/shared';
import fs from 'fs';
import path from 'path';

import { closeRedisConnection } from '../src/core/redis';
import { closeAllQueues } from '../src/core/queue';

afterAll(async () => {
  await closeAllQueues();
  await closeRedisConnection();
});

describe('Phase 0: Production Infrastructure & Baseline Tests', () => {
  describe('1. Environment Configuration', () => {
    test('Environment variables are loaded and validated strictly via Zod', () => {
      expect(env).toBeDefined();
      expect(env.PORT).toBeGreaterThan(0);
      expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(16);
      expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(16);
      expect(env.BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
    });
  });

  describe('2. Object Storage & KYC Vault Abstraction', () => {
    const storage = getStorageProvider();

    test('Storage provider uploads, checks existence, and deletes objects', async () => {
      const testKey = `kyc_test_${Date.now()}.txt`;
      const uploadRes = await storage.upload({
        key: testKey,
        body: 'Confidential Test KYC Payload',
        mimeType: 'text/plain',
        isPrivate: true,
      });

      expect(uploadRes.key).toBe(testKey);

      const exists = await storage.exists(testKey);
      expect(exists).toBe(true);

      await storage.delete(testKey);
      const existsAfterDelete = await storage.exists(testKey);
      expect(existsAfterDelete).toBe(false);
    });

    test('Signed KYC download URL strictly enforces maximum 300 seconds expiration', async () => {
      const signedUrl = await storage.getSignedUrl({
        key: 'kyc/cust_123/aadhaar.pdf',
        expiresInSeconds: 600, // Requesting 600s, must be clamped to 300s
        operation: 'getObject',
      });

      expect(signedUrl).toBeDefined();
      expect(signedUrl).toContain('X-Amz-Expires=300');
      expect(MAX_KYC_URL_EXPIRY_SECONDS).toBe(300);
    });
  });

  describe('3. Redis & BullMQ Infrastructure', () => {
    test('BullMQ queue is initialized with exponential retry policy and retention windows', () => {
      const queue = getQueue(QUEUE_NAMES.EMI_OPERATIONS);
      expect(queue).toBeDefined();
      expect(queue.name).toBe('crm-emi-operations-queue');
      expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
      expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
      expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBe(2000);
    });

    test('Distributed lock acquisition and release mechanics', async () => {
      const lockKey = `test_lock_${Date.now()}`;
      const { acquired, lockId } = await acquireDistributedLock(lockKey, 5000);
      expect(acquired).toBe(true);
      expect(lockId).toBeDefined();

      const released = await releaseDistributedLock(lockKey, lockId);
      expect(released).toBe(true);
    });
  });

  describe('4. PostgreSQL Migration & Audit Immutability Trigger', () => {
    test('Migration DDL contains PostgreSQL NUMERIC monetary fields and audit immutability trigger', () => {
      const migrationFile = path.join(__dirname, '../src/database/migrations/001_initial_schema.sql');
      expect(fs.existsSync(migrationFile)).toBe(true);

      const ddl = fs.readFileSync(migrationFile, 'utf8');

      // Verify NUMERIC(14,2) precision is used for monetary values
      expect(ddl).toContain('principal_amount NUMERIC(14,2)');
      expect(ddl).toContain('emi_amount NUMERIC(14,2)');
      expect(ddl).toContain('total_payable NUMERIC(14,2)');
      expect(ddl).toContain('outstanding_balance NUMERIC(14,2)');
      expect(ddl).toContain('expected_amount NUMERIC(14,2)');

      // Verify Audit Immutability trigger and function
      expect(ddl).toContain('CREATE OR REPLACE FUNCTION prevent_audit_tampering()');
      expect(ddl).toContain('RAISE EXCEPTION \'Audit logs are strictly immutable and cannot be updated or deleted.\'');
      expect(ddl).toContain('CREATE TRIGGER trg_protect_audit_logs');
      expect(ddl).toContain('BEFORE UPDATE OR DELETE ON audit_logs');
    });
  });

  describe('5. Centralized Date & Time (Asia/Kolkata Business TZ)', () => {
    test('Business date returns YYYY-MM-DD in Asia/Kolkata timezone', () => {
      const dateStr = getBusinessDateStr();
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
    });

    test('Display date formats to DD/MM/YYYY in Indian Standard format', () => {
      const display = formatDisplayDate('2026-09-19');
      expect(display).toBe('19/09/2026');
    });

    test('Overdue calculation returns correct integer difference', () => {
      expect(calculateDaysOverdue('2026-09-10', '2026-09-19')).toBe(9);
      expect(calculateDaysOverdue('2026-09-19', '2026-09-19')).toBe(0);
      expect(calculateDaysOverdue('2026-09-25', '2026-09-19')).toBe(0);
    });

    test('Next due date calculation handles monthly installments and month-end clamping', () => {
      // Regular monthly increment
      const due1 = calculateNextDueDate('2026-01-15', 1, RepaymentFrequency.MONTHLY);
      expect(due1).toBe('2026-02-15');

      // Month-end clamping: Jan 31 + 1 month in non-leap year clamps to Feb 28
      const dueFeb = calculateNextDueDate('2026-01-31', 1, RepaymentFrequency.MONTHLY);
      expect(dueFeb).toBe('2026-02-28');

      // March 31 + 1 month clamps to Apr 30
      const dueApr = calculateNextDueDate('2026-03-31', 1, RepaymentFrequency.MONTHLY);
      expect(dueApr).toBe('2026-04-30');
    });
  });
});
