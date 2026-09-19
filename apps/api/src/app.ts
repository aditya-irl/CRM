import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

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
import { EMIStateEngineJob } from './jobs/emi-state-engine.job';
import { ReminderDispatcherJob } from './jobs/reminder-dispatcher.job';
import { authenticate, requireRole } from './middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const app = express();

// Security and utility middlewares
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// Health Check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Finance & EMI Collection CRM API', timestamp: new Date().toISOString() });
});

// Mount V1 API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
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

// Admin trigger endpoint for manual execution of background jobs
app.post(
  '/api/v1/system/trigger-jobs',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (req, res, next) => {
    try {
      const { simulatedDate } = req.body;
      const transitionResult = await EMIStateEngineJob.runDailyTransition(simulatedDate);
      const reminderResult = await ReminderDispatcherJob.runReminderGeneration(simulatedDate);

      res.json({
        success: true,
        data: {
          transition: transitionResult,
          reminders: reminderResult,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Centralized error handling
app.use(errorHandler);

export default app;
