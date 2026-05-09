import { isValidUuid } from "../../utils/uuid.ts";
import { withTx } from "../../db/client.ts";
import { friendRequests } from "../../db/schema.ts";
import { enqueuePushNotification, publishWebSocketEvent } from "../../jobs/queue.ts";
import { isPgErrorCode, getPgConstraintName, PgErrorCode } from "../postgres_error.ts";
import { getUserSummaryById } from "../common_queries.ts";
import { getFriendRequestContext } from "../../db/queries/get_friend_request_context.ts";
import { AppError } from "../app_error.ts";

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

function normalizeRequesterId(requesterId: string): string {
  const value = requesterId.trim();
  if (value.length === 0) {
    throw new AppError<SendFriendRequestErrorType>(
      "MISSING_INPUT",
      "Requester id is required.",
      400,
    );
  }
  if (!isValidUuid(value)) {
    throw new AppError<SendFriendRequestErrorType>(
      "MISSING_INPUT",
      "Requester id is invalid.",
      400,
    );
  }
  return value;
}

function normalizeIdentifier(identifier: string): string {
  const value = identifier.trim();
  if (value.length === 0) {
    throw new AppError<SendFriendRequestErrorType>(
      "INVALID_IDENTIFIER",
      "Username or email is required.",
      400,
    );
  }
  return value;
}

export async function sendFriendRequest(
  requesterId: string,
  identifier: string,
): Promise<FriendRequestResult> {
  if (!requesterId || !identifier) {
    throw new AppError<SendFriendRequestErrorType>(
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
        throw new AppError<SendFriendRequestErrorType>("USER_NOT_FOUND", "User not found.", 404);
      }

      const ctx = await getFriendRequestContext(normalizedRequesterId, normalizedIdentifier, tx);

      if (!ctx) {
        throw new AppError<SendFriendRequestErrorType>("USER_NOT_FOUND", "User not found.", 404);
      }

      if (ctx.isBlocked) {
        throw new AppError<SendFriendRequestErrorType>("USER_NOT_FOUND", "User not found.", 404);
      }

      if (ctx.receiverId === normalizedRequesterId) {
        throw new AppError<SendFriendRequestErrorType>(
          "SELF_REQUEST",
          "You cannot send a friend request to yourself.",
          400,
        );
      }

      if (ctx.isFriend) {
        throw new AppError<SendFriendRequestErrorType>(
          "ALREADY_FRIENDS",
          "You are already friends with this user.",
          409,
        );
      }

      if (ctx.outgoingReqId) {
        throw new AppError<SendFriendRequestErrorType>(
          "REQUEST_ALREADY_SENT",
          "Friend request already sent.",
          409,
        );
      }

      if (ctx.incomingReqId) {
        throw new AppError<SendFriendRequestErrorType>(
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
          receiverId: ctx.receiverId,
        })
        .returning({
          id: friendRequests.id,
          requesterId: friendRequests.requesterId,
          receiverId: friendRequests.receiverId,
          createdAt: friendRequests.createdAt,
        });

      if (!inserted) {
        throw new AppError<SendFriendRequestErrorType>(
          "INTERNAL_ERROR",
          "Failed to create friend request.",
          500,
        );
      }

      return {
        requestResult: inserted,
        pushData: {
          requesterName: requester.displayName || requester.username || "Someone",
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
      };

      try {
        await enqueuePushNotification({
          recipientUserId: requestResult.receiverId,
          title: "New Friend Request",
          body: `${pushData.requesterName} sent you a friend request`,
          notificationType: "NEW_FRIEND_REQUEST",
          extraData: extraData,
        });
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification: ${err}`);
      }
    }

    return requestResult;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    if (isPgErrorCode(error, PgErrorCode.UNIQUE_VIOLATION)) {
      const constraint = getPgConstraintName(error);
      if (constraint === "friend_requests_unique_pair") {
        throw new AppError<SendFriendRequestErrorType>(
          "REQUEST_ALREADY_SENT",
          "Friend request already sent.",
          409,
        );
      }
    }

    if (isPgErrorCode(error, PgErrorCode.CHECK_VIOLATION)) {
      if (getPgConstraintName(error) === "friend_requests_no_self") {
        throw new AppError<SendFriendRequestErrorType>(
          "SELF_REQUEST",
          "You cannot send a friend request to yourself.",
          400,
        );
      }
    }

    console.error(`[ERROR] Unexpected error in use case: Send friend request\n`, error);
    throw new AppError<SendFriendRequestErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
