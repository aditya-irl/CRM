import { acquireDistributedLock, releaseDistributedLock } from '../core/redis';
import { EMIStateEngineJob } from './emi-state-engine.job';
import { ReminderDispatcherJob } from './reminder-dispatcher.job';
import { NotificationWorker } from '../modules/notifications/notification.worker';

export class BackgroundScheduler {
  /**
   * Execute daily EMI maintenance cycle protected by Redis distributed lock.
   * Safe to trigger across multiple instances simultaneously.
   */
  public static async executeDailyMaintenance(simulatedDate?: string) {
    const lockKey = 'cron:daily-emi-maintenance';
    const lock = await acquireDistributedLock(lockKey, 60000);

    if (!lock.acquired) {
      console.log('[BackgroundScheduler] Another pod/worker is executing daily maintenance. Skipping duplicate execution.');
      return { skipped: true, reason: 'Distributed lock not acquired' };
    }

    try {
      console.log('[BackgroundScheduler] Acquired lock. Running daily EMI state transitions and reminder generation...');
      const transitionResult = await EMIStateEngineJob.runDailyTransition(simulatedDate);
      const reminderResult = await ReminderDispatcherJob.runReminderGeneration(simulatedDate);

      return {
        skipped: false,
        transitionResult,
        reminderResult,
      };
    } finally {
      await releaseDistributedLock(lockKey, lock.lockId);
      console.log('[BackgroundScheduler] Released daily maintenance distributed lock.');
    }
  }

  /**
   * Start all background BullMQ workers.
   */
  public static startWorkers() {
    console.log('[BackgroundScheduler] Starting BullMQ workers...');
    const notifWorker = NotificationWorker.startWorker();
    return { notifWorker };
  }
}
