import { Router, Request, Response, NextFunction } from 'express';
import { PaymentService } from './payments.service';
import { authenticate, requireRole } from '../../middlewares/auth.middleware';
import { validateBody, validateQuery } from '../../middlewares/validate.middleware';
import { recordPaymentSchema, reversePaymentSchema, paymentsFilterSchema, UserRole } from '@crm/shared';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  validateBody(recordPaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;
      const result = await PaymentService.recordPayment(
        {
          ...req.body,
          idempotencyKey,
        },
        req.user!
      );
      const statusCode = (result as any).isIdempotentReplay ? 200 : 201;
      return res.status(statusCode).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/receipt/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const receipt = await PaymentService.getReceipt(req.params.id, req.user!);
    return res.json({
      success: true,
      data: receipt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/reverse',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  validateBody(reversePaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await PaymentService.reversePayment(req.params.id, req.body.reason, req.user!);
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

router.get('/summary', validateQuery(paymentsFilterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await PaymentService.getPaymentsSummary(req.user!, req.query);
    return res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await PaymentService.getPaymentById(req.params.id, req.user!);
    return res.json({
      success: true,
      data: payment,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', validateQuery(paymentsFilterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await PaymentService.listPayments(req.user!, req.query);
    return res.json({
      success: true,
      data: result.payments,
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

export default router;

