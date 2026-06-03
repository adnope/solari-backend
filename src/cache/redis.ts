import { Redis } from "ioredis";

const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";

export const cacheClient = new Redis(`redis://${redisHost}:${redisPort}`, {
  maxRetriesPerRequest: null,
});
