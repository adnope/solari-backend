import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { blockedUsers } from "../db/schema.ts";

type DbExecutor = typeof db | any;

// Check if user1 block user2 or the reverse
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

// Check if a user is blocked by another user
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
