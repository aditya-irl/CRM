import { Router, Request, Response, NextFunction } from 'express';
import { LoanService } from './loans.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import {
  calculateLoanSchema,
  createLoanSchema,
  approveLoanSchema,
  rejectLoanSchema,
  disburseLoanSchema,
  assignLoanAgentSchema,
  unassignLoanAgentSchema,
  UserRole,
} from '@crm/shared';

const router = Router();

router.use(authenticate);

/**
 * POST /api/v1/loans/calculate-preview
 * Calculate and preview amortization schedule without persisting.
 */
router.post(
  '/calculate-preview',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT, UserRole.DEALER),
  validateBody(calculateLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = LoanService.calculatePreview(req.body);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/loans
 * List loans with filtering, pagination, and collection agent portfolio scoping.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LoanService.listLoans(req.user!, req.query);
    return res.json({
      success: true,
      data: result.loans,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/loans/pending-approvals
 * Fetch all loans pending Super Admin / Admin approval.
 */
router.get(
  '/pending-approvals',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.getPendingApprovals(req.user!);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/loans/:id
 * Fetch loan details and full EMI amortization schedule (with IDOR protection).
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await LoanService.getLoanById(req.params.id, req.user!);
    return res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/loans
 * Book / originate a new loan with atomic EMI schedule generation.
 */
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  validateBody(createLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.createLoan(req.body, req.user!);
      return res.status(201).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/loans/:id/approve
 * Approve a pending loan application.
 */
router.post(
  '/:id/approve',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(approveLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.approveLoan(req.params.id, req.user!, req.body);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/loans/:id/reject
 * Reject a pending loan application.
 */
router.post(
  '/:id/reject',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(rejectLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.rejectLoan(req.params.id, req.user!, req.body);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/loans/:id/disburse
 * Disburse an approved loan and generate/activate EMI installments.
 */
router.post(
  '/:id/disburse',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(disburseLoanSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.disburseLoan(req.params.id, req.user!, req.body);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/loans/:id/assign
 * Assign or reassign a loan recovery case to a specific active Collection Agent.
 */
router.post(
  '/:id/assign',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(assignLoanAgentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.assignAgent(
        req.params.id,
        req.body.agentId,
        req.user!,
        req.body.notes
      );
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/loans/:id/unassign
 * Unassign a loan recovery case from its currently assigned agent.
 */
router.post(
  '/:id/unassign',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(unassignLoanAgentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.unassignAgent(
        req.params.id,
        req.user!,
        req.body.reason
      );
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/loans/:id/assignments
 * Fetch loan recovery assignment audit history.
 */
router.get(
  '/:id/assignments',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await LoanService.getLoanAssignmentHistory(req.params.id, req.user!);
      return res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
