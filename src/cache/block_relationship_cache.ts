import { deleteKey, getJson, setJson } from "./json_cache.ts";

type CachedBoolean = {
  value: boolean;
};

const BLOCK_RELATIONSHIP_CACHE_TTL_SECONDS = 600;

function getCanonicalPair(userId1: string, userId2: string): [string, string] {
  return userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];
}

function getBlockingRelationshipCacheKey(userId1: string, userId2: string): string {
  const [userLow, userHigh] = getCanonicalPair(userId1, userId2);
  return `block-relationship:${userLow}:${userHigh}`;
}

function getBlockedByCacheKey(blockerId: string, targetId: string): string {
  return `blocked-by:${blockerId}:${targetId}`;
}

export async function getCachedBlockingRelationship(
  userId1: string,
  userId2: string,
): Promise<boolean | null> {
  const cached = await getJson<CachedBoolean>(getBlockingRelationshipCacheKey(userId1, userId2));
  return cached ? cached.value : null;
}

export async function cacheBlockingRelationship(
  userId1: string,
  userId2: string,
  value: boolean,
): Promise<void> {
  await setJson(
    getBlockingRelationshipCacheKey(userId1, userId2),
    { value },
    BLOCK_RELATIONSHIP_CACHE_TTL_SECONDS,
  );
}

export async function deleteCachedBlockingRelationship(
  userId1: string,
  userId2: string,
): Promise<void> {
  await deleteKey(getBlockingRelationshipCacheKey(userId1, userId2));
}

export async function getCachedBlockedBy(
  blockerId: string,
  targetId: string,
): Promise<boolean | null> {
  const cached = await getJson<CachedBoolean>(getBlockedByCacheKey(blockerId, targetId));
  return cached ? cached.value : null;
}

export async function cacheBlockedBy(
  blockerId: string,
  targetId: string,
  value: boolean,
): Promise<void> {
  await setJson(
    getBlockedByCacheKey(blockerId, targetId),
    { value },
    BLOCK_RELATIONSHIP_CACHE_TTL_SECONDS,
  );
}

export async function deleteCachedBlockedBy(blockerId: string, targetId: string): Promise<void> {
  await deleteKey(getBlockedByCacheKey(blockerId, targetId));
}

export async function deleteCachedBlockingStateForPair(
  userId1: string,
  userId2: string,
): Promise<void> {
  await Promise.all([
    deleteCachedBlockingRelationship(userId1, userId2),
    deleteCachedBlockedBy(userId1, userId2),
    deleteCachedBlockedBy(userId2, userId1),
  ]);
}
