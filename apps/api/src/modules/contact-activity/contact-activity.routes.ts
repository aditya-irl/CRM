import { Router, Request, Response, NextFunction } from 'express';
import { ContactActivityService } from './contact-activity.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody, validateQuery } from '../../middlewares/validate.middleware';
import {
  createContactActivitySchema,
  updateFollowUpSchema,
  contactActivityQuerySchema,
  UserRole,
} from '@crm/shared';

const router = Router();

// All contact activity endpoints require authentication
router.use(authenticate);

// Gated strictly to internal collection and administrative roles; Dealers are rejected with 403 Forbidden
router.use(
  requireRole(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.BRANCH_MANAGER,
    UserRole.COLLECTION_AGENT
  )
);

/**
 * POST /api/v1/contact-activities
 * Logs a new contact attempt/activity with RLAC validation on assigned customer/loan.
 */
router.post(
  '/',
  validateBody(createContactActivitySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const activity = await ContactActivityService.createActivity(req.body, req.user!);
      return res.status(201).json({
        success: true,
        data: activity,
        message: 'Contact activity logged successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/contact-activities/summary
 * Retrieves today's 12 activity summary metrics (scoped to agent or overall).
 */
router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dateStr = req.query.date as string | undefined;
    const targetAgentId = req.query.agentId as string | undefined;
    const summary = await ContactActivityService.getTodaySummary(req.user!, dateStr, targetAgentId);
    return res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/contact-activities/admin-summary
 * Retrieves overall metrics and agent performance table (Admin/Manager only).
 */
router.get(
  '/admin-summary',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await ContactActivityService.getAdminSummary(req.user!, req.query as any);
      return res.json({
        success: true,
        data: summary,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/contact-activities/export
 * Exports activity reports as CSV (Admin/Manager only).
 */
router.get(
  '/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const csv = await ContactActivityService.exportActivitiesCsv(req.user!, req.query as any);
      const filename = `contact_activities_${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/contact-activities/customer/:customerId
 * Customer-level contact history timeline (RLAC-checked).
 */
router.get('/customer/:customerId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activities = await ContactActivityService.getCustomerActivities(
      req.params.customerId,
      req.user!
    );
    return res.json({
      success: true,
      data: activities,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/contact-activities/:id/follow-up
 * Updates follow-up status, notes, or payment commitment status with audit trail.
 */
router.patch(
  '/:id/follow-up',
  validateBody(updateFollowUpSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await ContactActivityService.updateFollowUp(
        req.params.id,
        req.body,
        req.user!
      );
      return res.json({
        success: true,
        data: updated,
        message: 'Follow-up updated successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/contact-activities
 * List contact activities with filtering, search, and pagination.
 */
router.get(
  '/',
  validateQuery(contactActivityQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await ContactActivityService.listActivities(req.user!, req.query as any);
      return res.json({
        success: true,
        data: result.activities,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
