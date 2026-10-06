import { Request, Response, NextFunction } from 'express';
import { DealerService } from './dealers.service';
import { createDealerSchema, updateDealerSchema, updateDealerStatusSchema, updateDealerLoginStatusSchema } from '@crm/shared';
import { AuthenticatedUser } from '../../middlewares/auth.middleware';

export class DealerController {
  public static async listDealers(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search, status, area } = req.query;
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.listDealers(
        {
          page: page ? Number(page) : undefined,
          limit: limit ? Number(limit) : undefined,
          search: search as string,
          status: status as string,
          area: area as string,
        },
        user
      );

      res.json({
        success: true,
        data: result.dealers,
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

  public static async getDealerById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.getDealerById(id, user);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getDealerMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as AuthenticatedUser;
      if (!user.dealerId) {
        return res.status(403).json({
          success: false,
          error: { message: 'Dealer identity missing in authentication session' },
        });
      }
      const result = await DealerService.getDealerById(user.dealerId, user);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async getDealerDashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as AuthenticatedUser;
      const { dealerId } = req.query;
      const result = await DealerService.getDealerDashboard(user, dealerId as string | undefined);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async createDealer(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = createDealerSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.createDealer(validated, user);

      res.status(201).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async updateDealer(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const validated = updateDealerSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.updateDealer(id, validated, user);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async updateDealerStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const validated = updateDealerStatusSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.updateDealerStatus(id, validated.status, user);

      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async createDealerLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.createDealerLogin(id, user);

      res.status(201).json({
        success: true,
        data: result,
        message: 'Dealer login credentials generated successfully. Share the temporary password securely.',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async resetDealerPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.resetDealerPassword(id, user);

      res.json({
        success: true,
        data: result,
        message: 'Dealer temporary password reset successfully.',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }

  public static async updateDealerLoginStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const validated = updateDealerLoginStatusSchema.parse(req.body);
      const user = req.user as AuthenticatedUser;
      const result = await DealerService.updateDealerLoginStatus(id, validated.status, user);

      res.json({
        success: true,
        data: result,
        message: `Dealer login account status updated to ${validated.status}.`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  }
}
