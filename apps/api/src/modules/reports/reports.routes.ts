import { Router, Request, Response, NextFunction } from 'express';
import { ReportService } from './reports.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

/**
 * Dashboard stats: Organization-wide for Admins; Scoped portfolio for Agents.
 */
router.get(
  '/dashboard-stats',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await ReportService.getDashboardStats(req.user!);
      return res.json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Daily collection report with date range, agent, route, and mode filters.
 */
router.get(
  '/daily-collections',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await ReportService.getDailyCollectionReport(req.query, req.user!);
      return res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Overdue Portfolio-at-Risk (PAR) aging report.
 */
router.get(
  '/overdue-par',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await ReportService.getOverdueParReport(req.query as any, req.user!);
      return res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Agent performance rankings (Admin / Branch Manager only).
 */
router.get(
  '/agent-performance',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await ReportService.getAgentPerformanceReport();
      return res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Controlled CSV export with RBAC and filter parity.
 */
router.get(
  '/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = (req.query.type as any) || 'daily-collections';
      const { filename, csvContent } = await ReportService.generateCsvExport(type, req.query, req.user!);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
