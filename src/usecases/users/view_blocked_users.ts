import { isValidUuid } from "../../utils/uuid.ts";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { blockedUsers } from "../../db/schema.ts";
import { getAvatarUrlMapByUserId } from "../avatar_urls.ts";
import { getUserSummariesByIds } from "../common_queries.ts";

export type ViewBlockedUsersErrorType =
  | "MISSING_USER_ID"
  | "INVALID_CURSOR"
  | "INVALID_LIMIT"
  | "INVALID_SORT"
  | "INTERNAL_ERROR";

export class ViewBlockedUsersError extends Error {
  readonly type: ViewBlockedUsersErrorType;
  readonly statusCode: number;

  constructor(type: ViewBlockedUsersErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "ViewBlockedUsersError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export type BlockedUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string;
};

export type ViewBlockedUsersResult = {
  items: BlockedUser[];
  nextCursor: string | null;
  limit: number;
};

function normalizeLimit(limit = 20): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ViewBlockedUsersError("INVALID_LIMIT", "Limit must be a positive integer.", 400);
  }
  return Math.min(limit, 100);
}

export async function viewBlockedUsers(
  userId: string,
  cursor?: string,
  limit = 20,
  sort: "newest" | "oldest" = "newest",
): Promise<ViewBlockedUsersResult> {
  const normalizedUserId = userId.trim();

  try {
    if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
      throw new ViewBlockedUsersError("MISSING_USER_ID", "User id is missing or invalid.", 400);
    }

    if (sort !== "newest" && sort !== "oldest") {
      throw new ViewBlockedUsersError("INVALID_SORT", "Sort must be 'newest' or 'oldest'.", 400);
    }

    if (cursor && Number.isNaN(Date.parse(cursor))) {
      throw new ViewBlockedUsersError(
        "INVALID_CURSOR",
        "Cursor must be a valid ISO date string.",
        400,
      );
    }

    const normalizedLimit = normalizeLimit(limit);
    const blockerCondition = eq(blockedUsers.blockerId, normalizedUserId);

    let cursorCondition = undefined;
    if (cursor) {
      if (sort === "newest") {
        cursorCondition = lt(blockedUsers.createdAt, cursor);
      } else {
        cursorCondition = gt(blockedUsers.createdAt, cursor);
      }
    }

    const whereCondition = cursorCondition
      ? and(blockerCondition, cursorCondition)
      : blockerCondition;
    const orderCondition =
      sort === "newest" ? desc(blockedUsers.createdAt) : asc(blockedUsers.createdAt);

    const blockedRows = await db
      .select({
        blockedId: blockedUsers.blockedId,
        createdAt: blockedUsers.createdAt,
      })
      .from(blockedUsers)
      .where(whereCondition)
      .orderBy(orderCondition)
      .limit(normalizedLimit);

    if (blockedRows.length === 0) {
      return {
        items: [],
        nextCursor: null,
        limit: normalizedLimit,
      };
    }

    const blockedIds = blockedRows.map((row) => row.blockedId);
    const uniqueBlockedIds = [...new Set(blockedIds)];

    const userMap = await getUserSummariesByIds(uniqueBlockedIds);
    const avatarUrlMap = await getAvatarUrlMapByUserId(userMap.values());

    const items: BlockedUser[] = blockedRows.map((row) => {
      const blockedUser = userMap.get(row.blockedId);

      if (!blockedUser) {
        throw new ViewBlockedUsersError("INTERNAL_ERROR", "Internal server error.", 500);
      }

      return {
        id: blockedUser.id,
        username: blockedUser.username,
        displayName: blockedUser.displayName,
        avatarUrl: avatarUrlMap.get(blockedUser.id) ?? null,
        blockedAt: row.createdAt,
      };
    });

    const nextCursor = items.length === normalizedLimit ? items[items.length - 1]!.blockedAt : null;

    return {
      items,
      nextCursor,
      limit: normalizedLimit,
    };
  } catch (error: unknown) {
    if (error instanceof ViewBlockedUsersError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: View blocked users\n`, error);
    throw new ViewBlockedUsersError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
