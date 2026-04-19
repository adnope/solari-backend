import { deleteKey, getJson, setJson } from "./json_cache.ts";

type CachedNickname = {
  nickname: string | null;
};

export type CachedNicknameLookup = {
  hit: boolean;
  nickname: string | null;
};

const NICKNAME_CACHE_TTL_SECONDS = 1800;

function getNicknameCacheKey(setterId: string, targetId: string): string {
  return `nickname:${setterId}:${targetId}`;
}

export async function getCachedNickname(
  setterId: string,
  targetId: string,
): Promise<CachedNicknameLookup> {
  const cached = await getJson<CachedNickname>(getNicknameCacheKey(setterId, targetId));

  if (!cached) {
    return { hit: false, nickname: null };
  }

  return { hit: true, nickname: cached.nickname };
}

export async function getCachedNicknames(
  setterId: string,
  targetIds: string[],
): Promise<Map<string, CachedNicknameLookup>> {
  const lookups = await Promise.all(
    targetIds.map(
      async (targetId) => [targetId, await getCachedNickname(setterId, targetId)] as const,
    ),
  );

  return new Map(lookups);
}

export async function cacheNickname(
  setterId: string,
  targetId: string,
  nickname: string | null,
): Promise<void> {
  await setJson<CachedNickname>(
    getNicknameCacheKey(setterId, targetId),
    { nickname },
    NICKNAME_CACHE_TTL_SECONDS,
  );
}

export async function cacheNicknames(
  setterId: string,
  nicknamesByTargetId: Map<string, string | null>,
): Promise<void> {
  await Promise.all(
    [...nicknamesByTargetId.entries()].map(([targetId, nickname]) =>
      cacheNickname(setterId, targetId, nickname),
    ),
  );
}

export async function deleteCachedNickname(setterId: string, targetId: string): Promise<void> {
  await deleteKey(getNicknameCacheKey(setterId, targetId));
}

export async function deleteCachedNicknamePair(userId1: string, userId2: string): Promise<void> {
  await Promise.all([
    deleteCachedNickname(userId1, userId2),
    deleteCachedNickname(userId2, userId1),
  ]);
}

export async function deleteCachedNicknames(
  pairs: Array<{ setterId: string; targetId: string }>,
): Promise<void> {
  const uniqueKeys = new Set<string>();
  const uniquePairs: Array<{ setterId: string; targetId: string }> = [];

  for (const pair of pairs) {
    const key = `${pair.setterId}:${pair.targetId}`;
    if (uniqueKeys.has(key)) {
      continue;
    }

    uniqueKeys.add(key);
    uniquePairs.push(pair);
  }

  await Promise.all(uniquePairs.map((pair) => deleteCachedNickname(pair.setterId, pair.targetId)));
}
