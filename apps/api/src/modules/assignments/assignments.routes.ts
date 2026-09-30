import { Router, Request, Response, NextFunction } from 'express';
import { AssignmentService } from './assignments.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody } from '../../middlewares/validate.middleware';
import { createAssignmentSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

// Create assignment (Admin / Branch Manager only)
router.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  validateBody(createAssignmentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AssignmentService.createAssignment(req.body, req.user!);
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

// List all assignments (Admin / Branch Manager)
router.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const agentId = req.query.agentId as string | undefined;
      const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;

      const assignments = await AssignmentService.listAssignments({ agentId, isActive });
      return res.json({
        success: true,
        data: assignments,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Get agent portfolio (RLAC: Agents can only view their own)
router.get(
  '/agent/:agentId',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.COLLECTION_AGENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const portfolio = await AssignmentService.getAgentPortfolio(req.params.agentId, req.user!);
      return res.json({
        success: true,
        data: portfolio,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Deactivate an assignment (Admin / Branch Manager)
router.patch(
  '/:id/deactivate',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await AssignmentService.deactivateAssignment(req.params.id, req.user!);
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
