import { RedisClient } from "bun";

const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";

export const cacheClient = new RedisClient(`redis://${redisHost}:${redisPort}`);
