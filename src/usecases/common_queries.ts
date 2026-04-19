import { and, eq, or, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { blockedUsers, friendNicknames } from "../db/schema.ts";
import {
  cacheNickname,
  cacheNicknames,
  getCachedNickname,
  getCachedNicknames,
} from "../cache/nickname_cache.ts";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

export async function hasBlockingRelationship(
  userId1: string,
  userId2: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [blockRecord] = await executor
    .select({ blockerId: blockedUsers.blockerId })
    .from(blockedUsers)
    .where(
      or(
        and(eq(blockedUsers.blockerId, userId1), eq(blockedUsers.blockedId, userId2)),
        and(eq(blockedUsers.blockerId, userId2), eq(blockedUsers.blockedId, userId1)),
      ),
    )
    .limit(1);

  return !!blockRecord;
}

export async function isBlockedBy(
  blockerId: string,
  targetId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [blockRecord] = await executor
    .select({ blockerId: blockedUsers.blockerId })
    .from(blockedUsers)
    .where(and(eq(blockedUsers.blockerId, blockerId), eq(blockedUsers.blockedId, targetId)))
    .limit(1);

  return !!blockRecord;
}

export async function getNicknameMap(
  setterId: string,
  targetIds: string[],
  executor: DbExecutor = db,
): Promise<Map<string, string>> {
  const uniqueTargetIds = Array.from(new Set(targetIds.filter(Boolean)));

  if (uniqueTargetIds.length === 0) {
    return new Map();
  }

  const nicknameMap = new Map<string, string>();
  const shouldUseCache = executor === db;
  let targetIdsToFetch = uniqueTargetIds;

  if (shouldUseCache) {
    const cachedNicknames = await getCachedNicknames(setterId, uniqueTargetIds);
    targetIdsToFetch = [];

    for (const targetId of uniqueTargetIds) {
      const cached = cachedNicknames.get(targetId);

      if (!cached?.hit) {
        targetIdsToFetch.push(targetId);
        continue;
      }

      if (cached.nickname !== null) {
        nicknameMap.set(targetId, cached.nickname);
      }
    }
  }

  if (targetIdsToFetch.length === 0) {
    return nicknameMap;
  }

  const results = await executor
    .select({
      targetId: friendNicknames.targetId,
      nickname: friendNicknames.nickname,
    })
    .from(friendNicknames)
    .where(
      and(
        eq(friendNicknames.setterId, setterId),
        inArray(friendNicknames.targetId, targetIdsToFetch),
      ),
    );

  const fetchedNicknames = new Map<string, string | null>(
    targetIdsToFetch.map((targetId) => [targetId, null]),
  );

  for (const row of results) {
    nicknameMap.set(row.targetId, row.nickname);
    fetchedNicknames.set(row.targetId, row.nickname);
  }

  if (shouldUseCache) {
    await cacheNicknames(setterId, fetchedNicknames);
  }

  return nicknameMap;
}

export async function getNickname(
  setterId: string,
  targetId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const shouldUseCache = executor === db;

  if (shouldUseCache) {
    const cached = await getCachedNickname(setterId, targetId);
    if (cached.hit) {
      return cached.nickname;
    }
  }

  const [record] = await executor
    .select({ nickname: friendNicknames.nickname })
    .from(friendNicknames)
    .where(and(eq(friendNicknames.setterId, setterId), eq(friendNicknames.targetId, targetId)))
    .limit(1);

  const nickname = record?.nickname ?? null;

  if (shouldUseCache) {
    await cacheNickname(setterId, targetId, nickname);
  }

  return nickname;
}
