import { isValidUuid } from "../../utils/uuid.ts";
import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendRequests, friendships, users } from "../../db/schema.ts";
import { enqueuePushNotification, publishWebSocketEventToUsers } from "../../jobs/queue.ts";
import { hasBlockingRelationship } from "../common_queries.ts";

export type AcceptFriendRequestResult = {
  id: string;
  requesterId: string;
  receiverId: string;
  createdAt: string;
};

export type AcceptFriendRequestErrorType =
  | "MISSING_INPUT"
  | "USER_NOT_FOUND"
  | "REQUEST_NOT_FOUND"
  | "SELF_REQUEST"
  | "ALREADY_FRIENDS"
  | "INTERNAL_ERROR";

export class AcceptFriendRequestError extends Error {
  readonly type: AcceptFriendRequestErrorType;
  readonly statusCode: number;

  constructor(type: AcceptFriendRequestErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "AcceptFriendRequestError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AcceptFriendRequestError("MISSING_INPUT", `${fieldName} is required.`, 400);
  }
  if (!isValidUuid(normalized)) {
    throw new AcceptFriendRequestError("MISSING_INPUT", `${fieldName} is invalid.`, 400);
  }
  return normalized;
}

export async function acceptFriendRequest(
  receiverId: string,
  requestId: string,
): Promise<AcceptFriendRequestResult> {
  const normalizedReceiverId = normalizeId(receiverId, "Receiver ID");
  const normalizedRequestId = normalizeId(requestId, "Request ID");

  try {
    const { result, pushData } = await withTx(async (tx) => {
      const [requestRow] = await tx
        .select({
          id: friendRequests.id,
          requesterId: friendRequests.requesterId,
          receiverId: friendRequests.receiverId,
          createdAt: friendRequests.createdAt,
        })
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.id, normalizedRequestId),
            eq(friendRequests.receiverId, normalizedReceiverId),
          ),
        )
        .limit(1);

      if (!requestRow) {
        throw new AcceptFriendRequestError(
          "REQUEST_NOT_FOUND",
          "Friend request not found or not for this user.",
          404,
        );
      }

      const isBlocked = await hasBlockingRelationship(
        requestRow.requesterId,
        requestRow.receiverId,
        tx,
      );
      if (isBlocked) {
        throw new AcceptFriendRequestError(
          "REQUEST_NOT_FOUND",
          "Friend request not found or not for this user.",
          404,
        );
      }

      if (requestRow.requesterId === requestRow.receiverId) {
        throw new AcceptFriendRequestError("SELF_REQUEST", "Cannot accept self request.", 400);
      }

      const [userLow, userHigh]: [string, string] =
        requestRow.requesterId < requestRow.receiverId
          ? [requestRow.requesterId, requestRow.receiverId]
          : [requestRow.receiverId, requestRow.requesterId];

      const [existingFriendship] = await tx
        .select({ userLow: friendships.userLow })
        .from(friendships)
        .where(and(eq(friendships.userLow, userLow), eq(friendships.userHigh, userHigh)))
        .limit(1);

      if (existingFriendship) {
        throw new AcceptFriendRequestError("ALREADY_FRIENDS", "Users are already friends.", 409);
      }

      await tx.insert(friendships).values({
        userLow,
        userHigh,
      });

      await tx.delete(friendRequests).where(eq(friendRequests.id, normalizedRequestId));

      const [acceptor] = await tx
        .select({
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedReceiverId))
        .limit(1);

      if (!acceptor) {
        throw new AcceptFriendRequestError("USER_NOT_FOUND", "User not found.", 404);
      }

      return {
        result: {
          id: requestRow.id,
          requesterId: requestRow.requesterId,
          receiverId: requestRow.receiverId,
          createdAt: requestRow.createdAt,
        },
        pushData: {
          acceptorName: acceptor.displayName || acceptor.username || "Someone",
          acceptorAvatarKey: acceptor.avatarKey,
          acceptorId: normalizedReceiverId,
        },
      };
    });

    const wsPayload = {
      type: "FRIEND_REQUEST_ACCEPTED" as const,
      payload: result,
    };

    await publishWebSocketEventToUsers([result.requesterId, result.receiverId], wsPayload);

    if (pushData) {
      const extraData = {
        acceptorId: pushData.acceptorId,
        avatarKey: pushData.acceptorAvatarKey || "",
      };

      try {
        await enqueuePushNotification({
          recipientUserId: result.requesterId,
          title: "Friend Request Accepted",
          body: `${pushData.acceptorName} accepted your friend request.`,
          notificationType: "FRIEND_REQUEST_ACCEPTED",
          extraData: extraData,
        });
      } catch (err) {
        console.error(`[ERROR] Failed to enqueue background push notification: ${err}`);
      }
    }

    return result;
  } catch (error) {
    if (error instanceof AcceptFriendRequestError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Accept friend request\n${error}`);
    throw new AcceptFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
