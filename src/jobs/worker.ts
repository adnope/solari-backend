import { Worker, type Job, type WorkerOptions } from "bullmq";
import { handlePostProcessing } from "./handlers/process_post_upload.ts";
import { handlePushNotification } from "./handlers/process_push_notification.ts";
import { handleSendEmail } from "./handlers/send_email.ts";
import {
  getJobStatusKey,
  getTrackedJobId,
  JOB_STATUS_TTL_SECONDS,
  redisClient,
} from "./queue.ts";
import type { QueueNameToPayLoadMap, QueueName } from "./types.ts";

type JobHandler<K extends QueueName> = (
  jobId: string,
  payload: QueueNameToPayLoadMap[K],
) => Promise<void>;

const jobQueueNameToHandlerMap: { [K in QueueName]: JobHandler<K> } = {
  "post-upload-processing": handlePostProcessing,
  "push-notification-processing": handlePushNotification,
  "send-email": handleSendEmail,
};

const registeredQueues = Object.keys(jobQueueNameToHandlerMap) as QueueName[];
const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";
const redisUrl = `redis://${redisHost}:${redisPort}`;

const baseWorkerOptions: WorkerOptions = {
  connection: {
    url: redisUrl,
    maxRetriesPerRequest: null,
  },
  removeOnComplete: {
    age: 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 86400,
    count: 5000,
  },
};

const queueWorkerOptions: { [K in QueueName]: WorkerOptions } = {
  "post-upload-processing": {
    ...baseWorkerOptions,
    concurrency: 1,
    lockDuration: 30000,
    stalledInterval: 30000,
  },
  "push-notification-processing": {
    ...baseWorkerOptions,
    concurrency: 10,
    lockDuration: 15000,
    stalledInterval: 15000,
  },
  "send-email": {
    ...baseWorkerOptions,
    concurrency: 1,
    lockDuration: 15000,
    stalledInterval: 15000,
  },
};

function getJobId(job: Job<unknown, unknown, string>): string {
  if (!job.id) {
    throw new Error(`BullMQ job '${job.name}' is missing an id.`);
  }

  return job.id;
}

async function updateJobStatus(
  jobId: string,
  status: "processing" | "completed" | "failed",
): Promise<void> {
  await redisClient.set(getJobStatusKey(jobId), status, "EX", JOB_STATUS_TTL_SECONDS);
}

function createWorker<K extends QueueName>(
  queueName: K,
  handler: JobHandler<K>,
): Worker<QueueNameToPayLoadMap[K], void, string> {
  const worker = new Worker<QueueNameToPayLoadMap[K], void, string>(
    queueName,
    async (job) => {
      const bullJobId = getJobId(job as Job<unknown, unknown, string>);
      const trackedJobId = getTrackedJobId(queueName, bullJobId, job.data);
      console.log(`[INFO] Picked job with ID: ${bullJobId}`);
      await updateJobStatus(trackedJobId, "processing");
      await handler(trackedJobId, job.data);
    },
    queueWorkerOptions[queueName],
  );

  worker.on("completed", async (job) => {
    const bullJobId = getJobId(job as Job<unknown, unknown, string>);
    const trackedJobId = getTrackedJobId(queueName, bullJobId, job.data);
    await updateJobStatus(trackedJobId, "completed");
    console.log(`[INFO] Successfully processed job with ID: ${bullJobId}`);
  });

  worker.on("failed", async (job, error) => {
    if (!job) {
      console.error(`[ERROR] Job failed before BullMQ exposed the job object:`, error);
      return;
    }

    const bullJobId = getJobId(job as Job<unknown, unknown, string>);
    const trackedJobId = getTrackedJobId(queueName, bullJobId, job.data);
    console.error(
      `[ERROR] Handler failed to process job with ID: '${bullJobId}' on queue '${queueName}':`,
      error,
    );
    await updateJobStatus(trackedJobId, "failed");
  });

  worker.on("error", (error) => {
    console.error(`[ERROR] Worker error on queue '${queueName}':`, error);
  });

  return worker;
}

export async function startWorker() {
  console.log(`[INFO] Listening on queues:\n- ${registeredQueues.join("\n- ")}`);

  const workers = [
    createWorker("post-upload-processing", handlePostProcessing),
    createWorker("push-notification-processing", handlePushNotification),
    createWorker("send-email", handleSendEmail),
  ];

  await Promise.all(workers.map((worker) => worker.waitUntilReady()));

  const shutdown = async (signal: string) => {
    console.log(`[INFO] Shutting down workers due to ${signal}...`);
    await Promise.allSettled(workers.map((worker) => worker.close()));
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

if (import.meta.main) {
  startWorker();
}
