import { RedisClient } from "bun";
import { wsPublisher } from "../websocket/publisher";

const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";

const redisUrl = `redis://${redisHost}:${redisPort}`;

export const redisClient = new RedisClient(redisUrl);
export const redisSubscriber = new RedisClient(redisUrl);

export async function initRedis() {
  try {
    const response = await redisClient.ping();

    if (response === "PONG") {
      console.log(`[INFO] Connected to Redis at ${redisHost}:${redisPort}`);
    } else {
      console.warn(`[WARN] Redis returned unexpected response: ${response}`);
    }

    redisSubscriber.subscribe("ws-events", (message) => {
      try {
        const event = JSON.parse(message);
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

export async function enqueueJob<T>(queueName: string, jobId: string, payload: T): Promise<string> {
  const jobString = JSON.stringify({
    id: jobId,
    data: payload,
  });

  await redisClient.lpush(queueName, jobString);
  await redisClient.set(`job:${jobId}:status`, "pending", "EX", 3600);

  return jobId;
}
