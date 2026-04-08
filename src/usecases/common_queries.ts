import { and, eq, or, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { blockedUsers, friendNicknames } from "../db/schema.ts";

type DbExecutor = typeof db | any;

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

  const results = await executor
    .select({
      targetId: friendNicknames.targetId,
      nickname: friendNicknames.nickname,
    })
    .from(friendNicknames)
    .where(
      and(
        eq(friendNicknames.setterId, setterId),
        inArray(friendNicknames.targetId, uniqueTargetIds),
      ),
    );

  const nicknameMap = new Map<string, string>();
  for (const row of results) {
    nicknameMap.set(row.targetId, row.nickname);
  }

  return nicknameMap;
}

export async function getNickname(
  setterId: string,
  targetId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const [record] = await executor
    .select({ nickname: friendNicknames.nickname })
    .from(friendNicknames)
    .where(and(eq(friendNicknames.setterId, setterId), eq(friendNicknames.targetId, targetId)))
    .limit(1);

  return record?.nickname ?? null;
}
