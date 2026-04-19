import { cacheClient } from "./redis.ts";

export async function getJson<T>(key: string): Promise<T | null> {
  try {
    const value = await cacheClient.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch (error) {
    console.warn(`[WARN] Cache read failed for key '${key}':`, error);
    return null;
  }
}

export async function setJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return;

  try {
    await cacheClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    console.warn(`[WARN] Cache write failed for key '${key}':`, error);
  }
}

export async function deleteKey(key: string): Promise<void> {
  try {
    await cacheClient.del(key);
  } catch (error) {
    console.warn(`[WARN] Cache delete failed for key '${key}':`, error);
  }
}
