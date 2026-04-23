import { and, eq, or, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { blockedUsers, friendNicknames, friendships, users } from "../db/schema.ts";
import {
  cacheBlockedBy,
  cacheBlockingRelationship,
  getCachedBlockedBy,
  getCachedBlockingRelationship,
} from "../cache/block_relationship_cache.ts";
import {
  cacheNickname,
  cacheNicknames,
  getCachedNickname,
  getCachedNicknames,
} from "../cache/nickname_cache.ts";
import { cacheFriendIds, getCachedFriendIds } from "../cache/friend_cache.ts";
import {
  cacheUserSummary,
  cacheUserSummaries,
  getCachedUserSummaries,
  getCachedUserSummary,
  type CachedUserSummary,
} from "../cache/user_summary_cache.ts";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

export type UserSummary = CachedUserSummary;

export async function hasBlockingRelationship(
  userId1: string,
  userId2: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const shouldUseCache = executor === db;

  if (shouldUseCache) {
    const cached = await getCachedBlockingRelationship(userId1, userId2);
    if (cached !== null) {
      return cached;
    }
  }

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

  const hasBlock = !!blockRecord;

  if (shouldUseCache) {
    await cacheBlockingRelationship(userId1, userId2, hasBlock);
  }

  return hasBlock;
}

export async function isBlockedBy(
  blockerId: string,
  targetId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const shouldUseCache = executor === db;

  if (shouldUseCache) {
    const cached = await getCachedBlockedBy(blockerId, targetId);
    if (cached !== null) {
      return cached;
    }
  }

  const [blockRecord] = await executor
    .select({ blockerId: blockedUsers.blockerId })
    .from(blockedUsers)
    .where(and(eq(blockedUsers.blockerId, blockerId), eq(blockedUsers.blockedId, targetId)))
    .limit(1);

  const isBlocked = !!blockRecord;

  if (shouldUseCache) {
    await cacheBlockedBy(blockerId, targetId, isBlocked);
  }

  return isBlocked;
}

export async function getFriendIds(userId: string, executor: DbExecutor = db): Promise<string[]> {
  const shouldUseCache = executor === db;

  if (shouldUseCache) {
    const cachedFriendIds = await getCachedFriendIds(userId);
    if (cachedFriendIds) {
      return cachedFriendIds;
    }
  }

  const friendshipRows = await executor
    .select({
      userLow: friendships.userLow,
      userHigh: friendships.userHigh,
    })
    .from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));

  const friendIds = friendshipRows.map((row) =>
    row.userLow === userId ? row.userHigh : row.userLow,
  );

  if (shouldUseCache) {
    await cacheFriendIds(userId, friendIds);
  }

  return friendIds;
}

export async function getUserSummaryById(
  userId: string,
  executor: DbExecutor = db,
): Promise<UserSummary | null> {
  const shouldUseCache = executor === db;

  if (shouldUseCache) {
    const cachedSummary = await getCachedUserSummary(userId);
    if (cachedSummary) {
      return cachedSummary;
    }
  }

  const [summary] = await executor
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (summary && shouldUseCache) {
    await cacheUserSummary(summary);
  }

  return summary ?? null;
}

export async function getUserSummariesByIds(
  userIds: string[],
  executor: DbExecutor = db,
): Promise<Map<string, UserSummary>> {
  const uniqueUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const shouldUseCache = executor === db;
  const summaryMap = new Map<string, UserSummary>();
  let userIdsToFetch = uniqueUserIds;

  if (shouldUseCache) {
    const cachedSummaries = await getCachedUserSummaries(uniqueUserIds);
    userIdsToFetch = [];

    for (const userId of uniqueUserIds) {
      const cachedSummary = cachedSummaries.get(userId);

      if (cachedSummary) {
        summaryMap.set(userId, cachedSummary);
      } else {
        userIdsToFetch.push(userId);
      }
    }
  }

  if (userIdsToFetch.length === 0) {
    return summaryMap;
  }

  const fetchedSummaries = await executor
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(users)
    .where(inArray(users.id, userIdsToFetch));

  for (const summary of fetchedSummaries) {
    summaryMap.set(summary.id, summary);
  }

  if (shouldUseCache) {
    await cacheUserSummaries(fetchedSummaries);
  }

  return summaryMap;
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
