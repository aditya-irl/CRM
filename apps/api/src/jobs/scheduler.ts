import { acquireDistributedLock, releaseDistributedLock } from '../core/redis';
import { EMIStateEngineJob } from './emi-state-engine.job';
import { ReminderDispatcherJob } from './reminder-dispatcher.job';
import { NotificationWorker } from '../modules/notifications/notification.worker';
import { Worker } from 'bullmq';
import { closeAllWorkers } from '../core/queue';

export class BackgroundScheduler {
  private static workersStarted = false;
  private static notifWorker: Worker | null = null;
  private static maintenanceTimer: NodeJS.Timeout | null = null;

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
   * Idempotent: guards against duplicate worker creation.
   */
  public static startWorkers() {
    if (this.workersStarted) {
      console.log('[BackgroundScheduler] Workers already running. Skipping duplicate startup.');
      return { notifWorker: this.notifWorker };
    }

    console.log('[BackgroundScheduler] Starting BullMQ workers...');
    this.notifWorker = NotificationWorker.startWorker();
    this.workersStarted = true;
    return { notifWorker: this.notifWorker };
  }

  /**
   * Start periodic daily maintenance scheduler.
   */
  public static startMaintenanceScheduler(intervalMs = 3600000): void {
    if (this.maintenanceTimer) {
      return;
    }
    this.maintenanceTimer = setInterval(async () => {
      try {
        await BackgroundScheduler.executeDailyMaintenance();
      } catch (err: any) {
        console.error('[BackgroundScheduler] Error executing scheduled maintenance:', err.message);
      }
    }, intervalMs);
    this.maintenanceTimer.unref();
  }

  /**
   * Stop all background workers and maintenance schedulers gracefully.
   */
  public static async stopWorkers(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }

    if (this.notifWorker) {
      try {
        await this.notifWorker.close();
      } catch {
        // Handled gracefully during shutdown
      }
      this.notifWorker = null;
    }

    await closeAllWorkers();
    this.workersStarted = false;
    console.log('[BackgroundScheduler] Background workers stopped cleanly.');
  }

  /**
   * Check if workers are currently active.
   */
  public static areWorkersRunning(): boolean {
    return this.workersStarted;
  }
}
