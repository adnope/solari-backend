import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendRequests, friendships, userDevices, users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { wsPublisher } from "../../websocket/publisher.ts";

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
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

      const tokenRows = await tx
        .select({
          deviceToken: userDevices.deviceToken,
        })
        .from(userDevices)
        .where(eq(userDevices.userId, requestRow.requesterId));

      return {
        result: {
          id: requestRow.id,
          requesterId: requestRow.requesterId,
          receiverId: requestRow.receiverId,
          createdAt: requestRow.createdAt,
        },
        pushData: {
          tokens: tokenRows.map((row) => row.deviceToken),
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

    wsPublisher.sendToUser(result.requesterId, wsPayload);
    wsPublisher.sendToUser(result.receiverId, wsPayload);

    if (pushData.tokens.length > 0) {
      const title = "Friend Request Accepted";
      const body = `${pushData.acceptorName} accepted your friend request.`;

      let avatarUrl = "";
      if (pushData.acceptorAvatarKey) {
        avatarUrl = await getFileUrl(pushData.acceptorAvatarKey);
      }

      const extraData = {
        acceptorId: pushData.acceptorId,
        avatarUrl,
      };

      void Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "FRIEND_REQUEST_ACCEPTED", extraData),
        ),
      ).catch(console.error);
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
