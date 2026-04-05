import { redisClient } from "./queue.ts";
import { handlePostProcessing } from "./handlers/process_post_upload.ts";

type JobHandler = (jobId: string, payload: any) => Promise<void>;

const jobRegistry: Record<string, JobHandler> = {
  "post-processing": handlePostProcessing,
};

const registeredQueues = Object.keys(jobRegistry);

export async function startWorker() {
  console.log(`[WORKER] Listening on queues: ${registeredQueues.join(", ")}`);

  while (true) {
    try {
      const result = await redisClient.brpop(...registeredQueues, 0);

      if (!result) continue;

      const [queueName, jobString] = result;
      const job = JSON.parse(jobString);
      const jobId = job.id;
      const payload = job.data;

      console.log(`[WORKER] Picked up '${queueName}' job (ID: ${jobId})`);
      await redisClient.set(`job:${jobId}:status`, "processing", "EX", 3600);

      const handler = jobRegistry[queueName];

      if (!handler) {
        throw new Error(`No handler registered for queue: ${queueName}`);
      }

      try {
        await handler(jobId, payload);

        await redisClient.set(`job:${jobId}:status`, "completed", "EX", 3600);
        console.log(`[WORKER] Successfully processed ${jobId}`);
      } catch (handlerError) {
        console.error(`[WORKER] Failed job ${jobId} on queue '${queueName}':`, handlerError);
        await redisClient.set(`job:${jobId}:status`, "failed", "EX", 3600);
      }
    } catch (redisError) {
      console.error("[WORKER] Redis connection error, waiting 2 seconds...", redisError);
      await Bun.sleep(2000);
    }
  }
}

if (import.meta.main) {
  startWorker();
}
