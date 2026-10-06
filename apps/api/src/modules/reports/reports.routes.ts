import { Router, Request, Response, NextFunction } from 'express';
import { ReportService } from './reports.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateQuery } from '../../middlewares/validate.middleware';
import { UserRole, financeDashboardFilterSchema, financeReportFilterSchema } from '@crm/shared';
import { AuditService } from '../audit/audit.service';

const router = Router();

router.use(authenticate);

/**
 * Task 8: Unified Executive Finance Dashboard
 */
router.get(
  '/finance-dashboard',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateQuery(financeDashboardFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await ReportService.getFinanceDashboard(req.user!, req.query as any);
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
 * Task 8: Unified Custom Finance & Operations Report
 */
router.get(
  '/custom',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateQuery(financeReportFilterSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await ReportService.getCustomReport(req.user!, req.query as any);
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
 * Dealer-Wise Financing Analytics
 * Total financed principal, down payment, collections, outstanding, overdue & volume
 */
router.get(
  '/dealer-financing-analytics',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await ReportService.getDealerFinancingAnalytics(req.user!, req.query as any);
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
 * Dashboard stats: Organization-wide for Admins; Scoped portfolio for Agents.
 */
router.get(
  '/dashboard-stats',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
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
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
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
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
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

// -------------------------------------------------------------
// TASK 9: CATEGORY-SPECIFIC & UNIFIED CSV EXPORT ENDPOINTS
// -------------------------------------------------------------

/**
 * Collections CSV Export: /api/v1/reports/collections/export
 */
router.get(
  '/collections/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = (req.query.type as string) || 'collections';
      const { filename, csvContent, recordCount } = await ReportService.generateCsvExport(type, req.query, req.user!);

      AuditService.log({
        userId: req.user!.id,
        action: 'REPORT_EXPORTED_CSV',
        entity: 'Report',
        entityId: 'collections',
        newState: { category: 'collections', reportType: type, filename, recordCount, filters: req.query },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Loans CSV Export: /api/v1/reports/loans/export
 */
router.get(
  '/loans/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = (req.query.type as string) || 'loans';
      const { filename, csvContent, recordCount } = await ReportService.generateCsvExport(type, req.query, req.user!);

      AuditService.log({
        userId: req.user!.id,
        action: 'REPORT_EXPORTED_CSV',
        entity: 'Report',
        entityId: 'loans',
        newState: { category: 'loans', reportType: type, filename, recordCount, filters: req.query },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Dealers CSV Export: /api/v1/reports/dealers/export & /reports/dealer/export
 */
const dealerExportHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const type = (req.query.type as string) || 'dealer';
    const { filename, csvContent, recordCount } = await ReportService.generateCsvExport(type, req.query, req.user!);

    AuditService.log({
      userId: req.user!.id,
      action: 'REPORT_EXPORTED_CSV',
      entity: 'Report',
      entityId: 'dealer',
      newState: { category: 'dealer', reportType: type, filename, recordCount, filters: req.query },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};
router.get('/dealers/export', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER), dealerExportHandler);
router.get('/dealer/export', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER), dealerExportHandler);

/**
 * Recovery CSV Export: /api/v1/reports/recovery/export
 */
router.get(
  '/recovery/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = (req.query.type as string) || 'recovery';
      const { filename, csvContent, recordCount } = await ReportService.generateCsvExport(type, req.query, req.user!);

      AuditService.log({
        userId: req.user!.id,
        action: 'REPORT_EXPORTED_CSV',
        entity: 'Report',
        entityId: 'recovery',
        newState: { category: 'recovery', reportType: type, filename, recordCount, filters: req.query },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Controlled CSV export with RBAC and filter parity (Unified endpoint).
 */
router.get(
  '/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const type = (req.query.type as string) || (req.query.category as string) || 'daily-collections';
      const { filename, csvContent, recordCount } = await ReportService.generateCsvExport(type, req.query, req.user!);

      AuditService.log({
        userId: req.user!.id,
        action: 'REPORT_EXPORTED_CSV',
        entity: 'Report',
        entityId: type,
        newState: { type, filename, recordCount, filters: req.query },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// TASK 9: GOOGLE SHEETS EXPORT ENDPOINTS
// -------------------------------------------------------------

/**
 * Export to Google Sheets: POST /api/v1/reports/export/google-sheets & POST /api/v1/reports/google-sheets/export
 */
const googleSheetsExportHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const typeOrCategory = (req.body.type as string) || (req.body.reportType as string) || (req.body.category as string) || (req.query.type as string) || (req.query.category as string) || 'all-collections';
    const filters = { ...req.query, ...req.body };
    delete filters.type;
    delete filters.reportType;
    delete filters.category;

    const result = await ReportService.exportToGoogleSheets(typeOrCategory, filters, req.user!);

    AuditService.log({
      userId: req.user!.id,
      action: 'REPORT_EXPORTED_GOOGLE_SHEETS',
      entity: 'Report',
      entityId: typeOrCategory,
      newState: {
        type: typeOrCategory,
        spreadsheetId: result.spreadsheetId,
        sheetTitle: result.sheetTitle,
        updatedRows: result.updatedRows,
        filters,
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    return res.status(200).json({
      success: true,
      message: `Report successfully exported to Google Sheets tab '${result.sheetTitle}'`,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

router.post(
  '/export/google-sheets',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  googleSheetsExportHandler
);

router.post(
  '/google-sheets/export',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  googleSheetsExportHandler
);

export default router;
