import { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { isPgError } from "../postgres_error.ts";
import { newUUIDv7 } from "../../utils/uuid.ts";

export type CreateConversationResult = {
  id: string;
  userLow: string;
  userHigh: string;
  createdAt: Date;
};

export type CreateConversationErrorType =
  | "MISSING_INPUT"
  | "CANNOT_CHAT_WITH_SELF"
  | "USER_NOT_FOUND"
  | "INTERNAL_ERROR";

export class CreateConversationError extends Error {
  readonly type: CreateConversationErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(
    type: CreateConversationErrorType,
    message: string,
    statusCode: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "CreateConversationError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function createConversation(
  userId: string,
  targetUserId: string,
): Promise<CreateConversationResult> {
  if (!userId || !targetUserId) {
    throw new CreateConversationError(
      "MISSING_INPUT",
      "User ID and Target User ID are required.",
      400,
    );
  }

  if (userId === targetUserId) {
    throw new CreateConversationError(
      "CANNOT_CHAT_WITH_SELF",
      "You cannot create a conversation with yourself.",
      400,
    );
  }

  const [userLow, userHigh] = [userId, targetUserId].sort();
  const newConversationId = newUUIDv7();

  try {
    return await withDb(async (client) => {
      const result = await client.queryObject<CreateConversationResult>(
        `
        WITH new_conv AS (
          INSERT INTO conversations (id, user_low, user_high)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_low, user_high) DO NOTHING
          RETURNING id, user_low AS "userLow", user_high AS "userHigh", created_at AS "createdAt"
        )
        SELECT id, "userLow", "userHigh", "createdAt" FROM new_conv
        UNION ALL
        SELECT id, user_low AS "userLow", user_high AS "userHigh", created_at AS "createdAt"
        FROM conversations
        WHERE user_low = $2 AND user_high = $3
        LIMIT 1;
        `,
        [newConversationId, userLow, userHigh],
      );

      return result.rows[0];
    });
  } catch (error) {
    if (error instanceof CreateConversationError) throw error;

    if (isPgError(error)) {
      if (error.fields.code === "23503") {
        throw new CreateConversationError("USER_NOT_FOUND", "Target user does not exist.", 404);
      }
      if (error.fields.code === "22P02") {
        throw new CreateConversationError("USER_NOT_FOUND", "Invalid user ID format.", 400);
      }
    }

    throw new CreateConversationError(
      "INTERNAL_ERROR",
      "Internal server error creating conversation.",
      500,
    );
  }
}
