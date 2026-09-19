import { Queue, Worker, QueueOptions, WorkerOptions, Job } from 'bullmq';
import { getRedisClient } from './redis';

// Standardized Job Names
export const JOB_NAMES = {
  EMI_DAILY_TRANSITION: 'crm:job:emi-state-transition',
  REMINDER_DISPATCH: 'crm:job:reminder-dispatch',
  REPORT_GENERATION: 'crm:job:report-generation',
} as const;

// Standardized Queue Names
export const QUEUE_NAMES = {
  EMI_OPERATIONS: 'crm-emi-operations-queue',
  NOTIFICATIONS: 'crm-notifications-queue',
  REPORTS: 'crm-reports-queue',
} as const;

// Standard Retry and Dead-Letter Configuration
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // 2s, 4s, 8s
  },
  removeOnComplete: {
    age: 86400 * 7, // Retain 7 days of completed jobs
    count: 1000,
  },
  removeOnFail: {
    age: 86400 * 30, // Retain 30 days of failed jobs for audit
  },
};

const queues: Map<string, Queue> = new Map();

/**
 * Get or create a BullMQ Queue
 */
export function getQueue(queueName: string): Queue {
  if (!queues.has(queueName)) {
    const connection = getRedisClient();
    const queue = new Queue(queueName, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queue.on('error', (_err) => {
      // Handled gracefully in offline test mode
    });
    queues.set(queueName, queue);
  }
  return queues.get(queueName)!;
}

/**
 * Register a BullMQ Worker with structured error logging
 */
export function createWorker<T = any, R = any>(
  queueName: string,
  processor: (job: Job<T, R>) => Promise<R>,
  opts?: Partial<WorkerOptions>
): Worker<T, R> {
  const connection = getRedisClient();

  const worker = new Worker<T, R>(queueName, processor, {
    connection,
    concurrency: 5,
    ...opts,
  });

  worker.on('completed', (job) => {
    console.log(`[BullMQ Worker] Job ${job.id} (${job.name}) completed on queue "${queueName}"`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[BullMQ Worker] Job ${job?.id} (${job?.name}) FAILED on queue "${queueName}":`, err.message);
  });

  return worker;
}

export async function closeAllQueues() {
  for (const [name, q] of queues.entries()) {
    try {
      await q.close();
    } catch {
      // ignore
    }
  }
  queues.clear();
}
