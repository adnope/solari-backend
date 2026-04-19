import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendRequests, friendships, users } from "../../db/schema.ts";
import { enqueuePushNotification, publishWebSocketEvent } from "../../jobs/queue.ts";
import { isPgErrorCode, getPgConstraintName, PgErrorCode } from "../postgres_error.ts";
import { getUserSummaryById, hasBlockingRelationship } from "../common_queries.ts";

export type FriendRequestResult = {
  id: string;
  requesterId: string;
  receiverId: string;
  createdAt: string;
};

export type SendFriendRequestErrorType =
  | "MISSING_INPUT"
  | "INVALID_IDENTIFIER"
  | "USER_NOT_FOUND"
  | "SELF_REQUEST"
  | "ALREADY_FRIENDS"
  | "REQUEST_ALREADY_SENT"
  | "REQUEST_ALREADY_RECEIVED"
  | "INTERNAL_ERROR";

export class SendFriendRequestError extends Error {
  readonly type: SendFriendRequestErrorType;
  readonly statusCode: number;

  constructor(type: SendFriendRequestErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "SendFriendRequestError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

function normalizeRequesterId(requesterId: string): string {
  const value = requesterId.trim();
  if (value.length === 0) {
    throw new SendFriendRequestError("MISSING_INPUT", "Requester id is required.", 400);
  }
  if (!isValidUuid(value)) {
    throw new SendFriendRequestError("MISSING_INPUT", "Requester id is invalid.", 400);
  }
  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.length === 0) {
    throw new SendFriendRequestError("INVALID_IDENTIFIER", "Username or email is required.", 400);
  }
  return value;
}

export async function sendFriendRequest(
  requesterId: string,
  identifier: string,
): Promise<FriendRequestResult> {
  if (!requesterId || !identifier) {
    throw new SendFriendRequestError(
      "MISSING_INPUT",
      "Requester ID or receiver identifier is missing.",
      400,
    );
  }

  const normalizedRequesterId = normalizeRequesterId(requesterId);
  const normalizedIdentifier = normalizeIdentifier(identifier);

  try {
    const { requestResult, pushData } = await withTx(async (tx) => {
      const requester = await getUserSummaryById(normalizedRequesterId, tx);

      if (!requester) {
        throw new SendFriendRequestError("USER_NOT_FOUND", "User not found.", 404);
      }

      const [receiver] = await tx
        .select({
          id: users.id,
        })
        .from(users)
        .where(
          normalizedIdentifier.includes("@")
            ? eq(users.email, normalizedIdentifier)
            : eq(users.username, normalizedIdentifier),
        )
        .limit(1);

      if (!receiver) {
        throw new SendFriendRequestError("USER_NOT_FOUND", "User not found.", 404);
      }

      const isBlocked = await hasBlockingRelationship(normalizedRequesterId, receiver.id, tx);
      if (isBlocked) {
        throw new SendFriendRequestError("USER_NOT_FOUND", "User not found.", 404);
      }

      if (receiver.id === normalizedRequesterId) {
        throw new SendFriendRequestError(
          "SELF_REQUEST",
          "You cannot send a friend request to yourself.",
          400,
        );
      }

      const [userLow, userHigh]: [string, string] =
        normalizedRequesterId < receiver.id
          ? [normalizedRequesterId, receiver.id]
          : [receiver.id, normalizedRequesterId];

      const [existingFriendship] = await tx
        .select({ userLow: friendships.userLow })
        .from(friendships)
        .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
        .limit(1);

      if (existingFriendship) {
        throw new SendFriendRequestError(
          "ALREADY_FRIENDS",
          "You are already friends with this user.",
          409,
        );
      }

      const [existingOutgoing] = await tx
        .select({ id: friendRequests.id })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, normalizedRequesterId),
            eq(friendRequests.receiverId, receiver.id),
          ),
        )
        .limit(1);

      if (existingOutgoing) {
        throw new SendFriendRequestError(
          "REQUEST_ALREADY_SENT",
          "Friend request already sent.",
          409,
        );
      }

      const [existingIncoming] = await tx
        .select({ id: friendRequests.id })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, receiver.id),
            eq(friendRequests.receiverId, normalizedRequesterId),
          ),
        )
        .limit(1);

      if (existingIncoming) {
        throw new SendFriendRequestError(
          "REQUEST_ALREADY_RECEIVED",
          "This user has already sent you a friend request.",
          409,
        );
      }

      const requestId = Bun.randomUUIDv7();

      const [inserted] = await tx
        .insert(friendRequests)
        .values({
          id: requestId,
          requesterId: normalizedRequesterId,
          receiverId: receiver.id,
        })
        .returning({
          id: friendRequests.id,
          requesterId: friendRequests.requesterId,
          receiverId: friendRequests.receiverId,
          createdAt: friendRequests.createdAt,
        });

      if (!inserted) {
        throw new SendFriendRequestError("INTERNAL_ERROR", "Failed to create friend request.", 500);
      }

      return {
        requestResult: inserted,
        pushData: {
          requesterName: requester.displayName || requester.username || "Someone",
          requesterAvatarKey: requester.avatarKey,
          requesterId: normalizedRequesterId,
        },
      };
    });

    await publishWebSocketEvent(requestResult.receiverId, {
      type: "NEW_FRIEND_REQUEST" as const,
      payload: requestResult,
    });

    if (pushData) {
      const extraData = {
        requesterId: pushData.requesterId,
        avatarKey: pushData.requesterAvatarKey || "",
      };

      try {
        await enqueuePushNotification({
          recipientUserId: requestResult.receiverId,
          title: "New Friend Request",
          body: `${pushData.requesterName} sent you a friend request.`,
          notificationType: "NEW_FRIEND_REQUEST",
          extraData: extraData,
        });
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification: ${err}`);
      }
    }

    return requestResult;
  } catch (error: unknown) {
    if (error instanceof SendFriendRequestError) {
      throw error;
    }

    if (isPgErrorCode(error, PgErrorCode.UNIQUE_VIOLATION)) {
      const constraint = getPgConstraintName(error);
      if (constraint === "friend_requests_unique_pair") {
        throw new SendFriendRequestError(
          "REQUEST_ALREADY_SENT",
          "Friend request already sent.",
          409,
        );
      }
    }

    if (isPgErrorCode(error, PgErrorCode.CHECK_VIOLATION)) {
      if (getPgConstraintName(error) === "friend_requests_no_self") {
        throw new SendFriendRequestError(
          "SELF_REQUEST",
          "You cannot send a friend request to yourself.",
          400,
        );
      }
    }

    console.error(`[ERROR] Unexpected error in use case: Send friend request\n`, error);
    throw new SendFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
