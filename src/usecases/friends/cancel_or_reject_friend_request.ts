import { isValidUuid } from "../../utils/validation.ts";
import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendRequests } from "../../db/schema.ts";
import { publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { AppError } from "../app_error.ts";

export type CancelOrRejectFriendRequestErrorType =
  | "MISSING_INPUT"
  | "REQUEST_NOT_FOUND"
  | "NOT_REQUESTER_OR_RECEIVER"
  | "INTERNAL_ERROR";

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError<CancelOrRejectFriendRequestErrorType>(
      "MISSING_INPUT",
      `${fieldName} is required.`,
      400,
    );
  }
  if (!isValidUuid(normalized)) {
    throw new AppError<CancelOrRejectFriendRequestErrorType>(
      "MISSING_INPUT",
      `${fieldName} is invalid.`,
      400,
    );
  }
  return normalized;
}

export async function cancelOrRejectFriendRequest(
  userId: string,
  requestId: string,
): Promise<void> {
  const normalizedUserId = normalizeId(userId, "User ID");
  const normalizedRequestId = normalizeId(requestId, "Request ID");

  try {
    const requestData = await withTx(async (tx) => {
      const [requestRow] = await tx
        .select({
          id: friendRequests.id,
          requesterId: friendRequests.requesterId,
          receiverId: friendRequests.receiverId,
        })
        .from(friendRequests)
        .where(eq(friendRequests.id, normalizedRequestId))
        .limit(1);

      if (!requestRow) {
        throw new AppError<CancelOrRejectFriendRequestErrorType>(
          "REQUEST_NOT_FOUND",
          "Friend request not found.",
          404,
        );
      }

      if (
        requestRow.requesterId !== normalizedUserId &&
        requestRow.receiverId !== normalizedUserId
      ) {
        throw new AppError<CancelOrRejectFriendRequestErrorType>(
          "NOT_REQUESTER_OR_RECEIVER",
          "You are neither the requester nor the receiver.",
          403,
        );
      }

      await tx.delete(friendRequests).where(eq(friendRequests.id, normalizedRequestId));

      return requestRow;
    });

    const wsPayload = {
      type: "FRIEND_REQUEST_REMOVED" as const,
      payload: {
        requestId: requestData.id,
        requesterId: requestData.requesterId,
        receiverId: requestData.receiverId,
      },
    };

    await publishWebSocketEventToUsers(
      [requestData.requesterId, requestData.receiverId],
      wsPayload,
    );
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(
      `[ERROR] Unexpected error in use case: Cancel or reject friend request\n${error}`,
    );
    throw new AppError<CancelOrRejectFriendRequestErrorType>(
      "INTERNAL_ERROR",
      "Internal server error.",
      500,
    );
  }
}
