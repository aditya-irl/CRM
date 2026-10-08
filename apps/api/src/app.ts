import express from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';

import { errorHandler } from './middlewares/error.middleware';
import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/users/users.routes';
import customerRoutes from './modules/customers/customers.routes';
import kycRoutes from './modules/kyc/kyc.routes';
import loanRoutes from './modules/loans/loans.routes';
import emiRoutes from './modules/emi/emi.routes';
import paymentRoutes from './modules/payments/payments.routes';
import callLogRoutes from './modules/call-logs/call-logs.routes';
import assignmentRoutes from './modules/assignments/assignments.routes';
import reportRoutes from './modules/reports/reports.routes';
import auditRoutes from './modules/audit/audit.routes';
import dealerRoutes from './modules/dealers/dealers.routes';
import dealerCollectionsRoutes from './modules/dealer-collections/dealer-collections.routes';
import dealerSettlementsRoutes from './modules/dealer-settlements/dealer-settlements.routes';
import agentCollectionsRoutes from './modules/agent-collections/agent-collections.routes';
import directCollectionsRoutes from './modules/direct-collections/direct-collections.routes';
import portalRoutes from './modules/portal/portal.routes';
import settingsRoutes from './modules/settings/settings.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import { EMIStateEngineJob } from './jobs/emi-state-engine.job';
import { ReminderDispatcherJob } from './jobs/reminder-dispatcher.job';
import { BackgroundScheduler } from './jobs/scheduler';
import { AuditService } from './modules/audit/audit.service';
import { authenticate, requireRole } from './middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const app = express();

// --- Blocker 1: Secure, environment-based CORS ---
// CORS_ORIGIN accepts a single origin or comma-separated list of origins.
// In production, an explicit value is required. In dev/test, defaults to permissive if unset.
const buildCorsOptions = (): CorsOptions => {
  const rawOrigin = env.CORS_ORIGIN.trim();

  if (!rawOrigin) {
    // Dev/test convenience: no CORS_ORIGIN set — allow all origins (non-production only)
    if (env.NODE_ENV === 'production') {
      // Should not reach here: env validation also warns, but be safe
      console.warn('[CORS] WARNING: CORS_ORIGIN is not set in production. Blocking all cross-origin requests.');
      return { origin: false, credentials: true };
    }
    return { origin: true, credentials: true };
  }

  if (rawOrigin === '*') {
    return { origin: '*' };
  }

  // Support comma-separated origin list: "https://app.example.com,https://admin.example.com"
  const allowedOrigins = rawOrigin.split(',').map((o) => o.trim()).filter(Boolean);

  return {
    origin: (requestOrigin, callback) => {
      // Allow server-to-server requests (no Origin header)
      if (!requestOrigin) return callback(null, true);
      if (allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin "${requestOrigin}" is not allowed.`));
      }
    },
    credentials: true,
  };
};

// Security and utility middlewares
app.use(helmet());
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Finance & EMI Collection CRM API', timestamp: new Date().toISOString() });
});

// Mount V1 API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dealers', dealerRoutes);
app.use('/api/v1/dealer-collections', dealerCollectionsRoutes);
app.use('/api/v1/dealer-settlements', dealerSettlementsRoutes);
app.use('/api/v1/agent-collections', agentCollectionsRoutes);
app.use('/api/v1/direct-collections', directCollectionsRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/kyc', kycRoutes);
app.use('/api/v1/loans', loanRoutes);
app.use('/api/v1/agent', emiRoutes);
app.use('/api/v1/emi', emiRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/call-logs', callLogRoutes);
app.use('/api/v1/assignments', assignmentRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/audit-logs', auditRoutes);
app.use('/api/v1/portal', portalRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// Admin trigger endpoint for manual execution of background jobs (Midnight Engine)
app.post(
  '/api/v1/system/trigger-jobs',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req, res, next) => {
    try {
      const { simulatedDate } = req.body || {};
      const maintenanceResult = await BackgroundScheduler.executeDailyMaintenance(simulatedDate);

      if (maintenanceResult.skipped) {
        return res.json({
          success: true,
          processed: 0,
          skipped: 1,
          failed: 0,
          message: 'Midnight Engine execution skipped: daily maintenance is already running on another pod/worker.',
          data: {
            skipped: true,
            reason: maintenanceResult.reason,
            transition: {
              dueTodayUpdated: 0,
              overdueUpdated: 0,
              paidCorrected: 0,
              agingRefreshed: 0,
              unchanged: 0,
              totalEvaluated: 0,
              executedForDate: simulatedDate || new Date().toISOString().split('T')[0],
            },
            reminders: {
              executedForDate: simulatedDate || new Date().toISOString().split('T')[0],
              totalCandidates: 0,
              newRemindersCreated: 0,
              duplicateRemindersSuppressed: 0,
              enqueuedJobsCount: 0,
            },
          },
          timestamp: new Date().toISOString(),
        });
      }

      const tResult = maintenanceResult.transitionResult;
      const rResult = maintenanceResult.reminderResult;
      const processedCount = tResult
        ? (tResult.dueTodayUpdated + tResult.overdueUpdated + tResult.paidCorrected + tResult.agingRefreshed)
        : 0;

      await AuditService.log({
        userId: req.user!.id,
        action: 'MIDNIGHT_ENGINE_TRIGGERED_MANUAL',
        entity: 'System',
        entityId: 'midnight-engine',
        newState: {
          simulatedDate: simulatedDate || null,
          processed: processedCount,
          totalEvaluated: tResult?.totalEvaluated || 0,
          remindersCreated: rResult?.newRemindersCreated || 0,
        },
      });

      return res.json({
        success: true,
        processed: processedCount,
        skipped: 0,
        failed: 0,
        data: {
          skipped: false,
          transition: tResult,
          reminders: rResult,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[MidnightEngine] Manual trigger execution error:', err.message);
      return res.status(500).json({
        success: false,
        processed: 0,
        skipped: 0,
        failed: 1,
        error: {
          code: 'MIDNIGHT_ENGINE_FAILED',
          message: 'Failed to complete daily maintenance execution. Please try again.',
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// Centralized error handling
app.use(errorHandler);

export default app;
