import { Router } from 'express';
import { DealerController } from './dealers.controller';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { UserRole } from '@crm/shared';

const router = Router();

// Store Partner self-service endpoints (Scoped to authenticated dealer)
router.get('/dashboard', authenticate, DealerController.getDealerDashboard);
router.get('/me', authenticate, DealerController.getDealerMe);

// Authenticated read endpoints (Scoped with RLAC)
// GET / — requires only authentication; service layer applies RLAC projection per role.
//   COLLECTION_AGENT: receives minimal safe fields (id, storeName, etc.) for payment dropdown.
//   All other roles: full dealer-management response.
router.get('/', authenticate, DealerController.listDealers);

// GET /:id — admin/dealer detail view with recent loans (contains customer PII).
//   COLLECTION_AGENT is excluded: they have no UI workflow requiring individual dealer detail.
router.get(
  '/:id',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER, UserRole.DEALER),
  DealerController.getDealerById
);

// Admin & Branch Manager only dealer store mutations
router.post(
  '/',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.createDealer
);

router.patch(
  '/:id',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.updateDealer
);

router.patch(
  '/:id/status',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.updateDealerStatus
);

// Admin & Branch Manager only dealer account / authentication management
router.post(
  '/:id/login-account',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.createDealerLogin
);

router.post(
  '/:id/reset-password',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.resetDealerPassword
);

router.patch(
  '/:id/login-status',
  authenticate,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.BRANCH_MANAGER),
  DealerController.updateDealerLoginStatus
);

export default router;
