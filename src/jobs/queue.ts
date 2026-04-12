import { RedisClient } from "bun";
import { Queue, type JobsOptions, type QueueOptions } from "bullmq";
import { wsPublisher } from "../websocket/publisher";
import type { WsServerEvent } from "../websocket/types";
import type {
  PushNotificationPayload,
  QueueName,
  QueueNameToPayLoadMap,
  SendEmailPayload,
  UploadPostJobPayload,
} from "./types";

const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";

const redisUrl = `redis://${redisHost}:${redisPort}`;
const redisPortNumber = Number.parseInt(redisPort, 10);

if (!Number.isInteger(redisPortNumber) || redisPortNumber <= 0) {
  throw new Error(`Invalid REDIS_PORT value '${redisPort}'.`);
}

const bullConnection: QueueOptions["connection"] = {
  url: redisUrl,
  maxRetriesPerRequest: null,
};

const defaultJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: {
    age: 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 86400,
    count: 5000,
  },
};

export const JOB_STATUS_TTL_SECONDS = 3600;
const WS_EVENTS_CHANNEL = "ws-events";

export const redisClient = new RedisClient(redisUrl);
export const redisSubscriber = new RedisClient(redisUrl);

type JobQueue<K extends QueueName> = Queue<
  QueueNameToPayLoadMap[K],
  void,
  string,
  QueueNameToPayLoadMap[K],
  void,
  string
>;

function createJobQueue<K extends QueueName>(queueName: K): JobQueue<K> {
  return new Queue<QueueNameToPayLoadMap[K], void, string, QueueNameToPayLoadMap[K], void, string>(
    queueName,
    {
      connection: bullConnection,
      defaultJobOptions,
    },
  );
}

export function getJobStatusKey(jobId: string): string {
  return `job:${jobId}:status`;
}

export function getTrackedJobId(
  queueName: QueueName,
  jobId: string,
  payload: QueueNameToPayLoadMap[QueueName],
): string {
  switch (queueName) {
    case "post-upload-processing":
      return (payload as UploadPostJobPayload).postId;
    case "push-notification-processing":
    case "send-email":
      return jobId;
  }
}

const jobQueues: { [K in QueueName]: JobQueue<K> } = {
  "post-upload-processing": createJobQueue("post-upload-processing"),
  "push-notification-processing": createJobQueue("push-notification-processing"),
  "send-email": createJobQueue("send-email"),
};

export function getJobQueue<K extends QueueName>(queueName: K): JobQueue<K> {
  return jobQueues[queueName];
}

export async function publishWebSocketEvent(userId: string, event: WsServerEvent): Promise<number> {
  return redisClient.publish(
    WS_EVENTS_CHANNEL,
    JSON.stringify({
      userId,
      message: event,
    }),
  );
}

export async function publishWebSocketEventToUsers(
  userIds: string[],
  event: WsServerEvent,
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  await Promise.all(uniqueUserIds.map((userId) => publishWebSocketEvent(userId, event)));
}

export async function initRedis() {
  try {
    const response = await redisClient.ping();

    if (response === "PONG") {
      console.log(`[INFO] Connected to Redis at ${redisHost}:${redisPort}`);
    } else {
      console.warn(`[WARN] Redis returned unexpected response: ${response}`);
    }

    redisSubscriber.subscribe(WS_EVENTS_CHANNEL, (message) => {
      try {
        const event = JSON.parse(message);
        console.log(`Sending websocket events to user: ${event.userId}`);
        wsPublisher.sendToUser(event.userId, event.message);
      } catch (error) {
        console.error("Failed to parse websocket event from Redis", error);
      }
    });
  } catch (error) {
    console.error(
      `[ERROR] Failed to connect to Redis at ${redisHost}:${redisPort}. Ensure the container is running.`,
      error,
    );
  }
}

export async function enqueueJob<K extends QueueName>(
  queueName: K,
  jobId: string,
  payload: QueueNameToPayLoadMap[K],
): Promise<string> {
  await getJobQueue(queueName).add("process", payload, {
    jobId,
  });
  await redisClient.set(
    getJobStatusKey(getTrackedJobId(queueName, jobId, payload)),
    "pending",
    "EX",
    JOB_STATUS_TTL_SECONDS,
  );

  return jobId;
}

export async function enqueuePostUploadProcessing(payload: UploadPostJobPayload): Promise<string> {
  return enqueueJob("post-upload-processing", `post-upload-${payload.postId}`, payload);
}

export async function enqueuePushNotification(
  payload: PushNotificationPayload,
  jobId: string = Bun.randomUUIDv7(),
): Promise<string> {
  return enqueueJob("push-notification-processing", `push-notif-${jobId}`, payload);
}

export async function enqueueSendEmail(
  payload: SendEmailPayload,
  jobId: string = Bun.randomUUIDv7(),
): Promise<string> {
  return enqueueJob("send-email", jobId, payload);
}
