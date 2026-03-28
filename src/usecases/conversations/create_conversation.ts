import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversations, users } from "../../db/schema.ts";

export type CreateConversationResult = {
  id: string;
  userLow: string;
  userHigh: string;
  createdAt: string;
};

export type CreateConversationErrorType =
  | "MISSING_INPUT"
  | "CANNOT_CHAT_WITH_SELF"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class CreateConversationError extends Error {
  readonly type: CreateConversationErrorType;
  readonly statusCode: number;

  constructor(type: CreateConversationErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "CreateConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function createConversation(
  userId: string,
  targetUserId: string,
): Promise<CreateConversationResult> {
  const normalizedUserId = userId.trim();
  const normalizedTargetUserId = targetUserId.trim();

  if (!normalizedUserId || !normalizedTargetUserId) {
    throw new CreateConversationError("MISSING_INPUT", "User IDs are required.", 400);
  }

  if (!isValidUuid(normalizedUserId) || !isValidUuid(normalizedTargetUserId)) {
    throw new CreateConversationError("USER_NOT_FOUND", "Invalid ID format.", 400);
  }

  if (normalizedUserId === normalizedTargetUserId) {
    throw new CreateConversationError(
      "CANNOT_CHAT_WITH_SELF",
      "You cannot chat with yourself.",
      400,
    );
  }

  const [userLow, userHigh]: [string, string] =
    normalizedUserId < normalizedTargetUserId
      ? [normalizedUserId, normalizedTargetUserId]
      : [normalizedTargetUserId, normalizedUserId];
  const newConversationId = Bun.randomUUIDv7();

  try {
    const existingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [userLow, userHigh]));

    if (existingUsers.length !== 2) {
      throw new CreateConversationError("USER_NOT_FOUND", "Target user does not exist.", 404);
    }

    const inserted = await db
      .insert(conversations)
      .values({
        id: newConversationId,
        userLow,
        userHigh,
      })
      .onConflictDoNothing({
        target: [conversations.userLow, conversations.userHigh],
      })
      .returning({
        id: conversations.id,
        userLow: conversations.userLow,
        userHigh: conversations.userHigh,
        createdAt: conversations.createdAt,
      });

    if (inserted[0]) {
      return inserted[0];
    }

    const [existing] = await db
      .select({
        id: conversations.id,
        userLow: conversations.userLow,
        userHigh: conversations.userHigh,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(and(eq(conversations.userLow, userLow), eq(conversations.userHigh, userHigh)));

    if (!existing) {
      throw new CreateConversationError("INTERNAL_ERROR", "Error creating conversation.", 500);
    }

    return existing;
  } catch (error) {
    if (error instanceof CreateConversationError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Create conversation\n${error}`)
    throw new CreateConversationError("INTERNAL_ERROR", "Error creating conversation.", 500);
  }
}
