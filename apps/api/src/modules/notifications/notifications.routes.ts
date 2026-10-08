import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware';
import { NotificationController } from './notifications.controller';

const router = Router();

router.use(authenticate);

router.get('/', NotificationController.listNotifications);
router.get('/unread-count', NotificationController.getUnreadCount);
router.patch('/mark-all-read', NotificationController.markAllAsRead);
router.post('/mark-all-read', NotificationController.markAllAsRead);
router.patch('/:id/read', NotificationController.markAsRead);
router.post('/:id/read', NotificationController.markAsRead);

export default router;
