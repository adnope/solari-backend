import { deleteKey, getJson, setJson } from "./json_cache.ts";

export type CachedUserSummary = {
  id: string;
  username: string;
  displayName: string | null;
  avatarKey: string | null;
};

const USER_SUMMARY_CACHE_TTL_SECONDS = 600;

function getUserSummaryCacheKey(userId: string): string {
  return `user-summary:${userId}`;
}

export async function getCachedUserSummary(userId: string): Promise<CachedUserSummary | null> {
  return await getJson<CachedUserSummary>(getUserSummaryCacheKey(userId));
}

export async function getCachedUserSummaries(
  userIds: string[],
): Promise<Map<string, CachedUserSummary>> {
  const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  const summaries = await Promise.all(
    uniqueUserIds.map(async (userId) => [userId, await getCachedUserSummary(userId)] as const),
  );

  return new Map(
    summaries.flatMap(([userId, summary]) => (summary ? [[userId, summary] as const] : [])),
  );
}

export async function cacheUserSummary(summary: CachedUserSummary): Promise<void> {
  await setJson(getUserSummaryCacheKey(summary.id), summary, USER_SUMMARY_CACHE_TTL_SECONDS);
}

export async function cacheUserSummaries(summaries: CachedUserSummary[]): Promise<void> {
  await Promise.all(summaries.map((summary) => cacheUserSummary(summary)));
}

export async function deleteCachedUserSummary(userId: string): Promise<void> {
  await deleteKey(getUserSummaryCacheKey(userId));
}

export async function deleteCachedUserSummaries(userIds: string[]): Promise<void> {
  const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(uniqueUserIds.map((userId) => deleteCachedUserSummary(userId)));
}
