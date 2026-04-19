import { deleteKey, getJson, setJson } from "./json_cache.ts";

const FRIEND_IDS_CACHE_TTL_SECONDS = 300;

function getFriendIdsCacheKey(userId: string): string {
  return `friend-ids:${userId}`;
}

export async function getCachedFriendIds(userId: string): Promise<string[] | null> {
  return await getJson<string[]>(getFriendIdsCacheKey(userId));
}

export async function cacheFriendIds(userId: string, friendIds: string[]): Promise<void> {
  await setJson(getFriendIdsCacheKey(userId), friendIds, FRIEND_IDS_CACHE_TTL_SECONDS);
}

export async function deleteCachedFriendIds(userId: string): Promise<void> {
  await deleteKey(getFriendIdsCacheKey(userId));
}

export async function deleteCachedFriendIdsForUsers(userIds: string[]): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(uniqueUserIds.map((userId) => deleteCachedFriendIds(userId)));
}
