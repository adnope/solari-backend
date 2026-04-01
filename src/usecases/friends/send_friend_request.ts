import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { friendRequests, friendships, userDevices, users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import { isPgError } from "../postgres_error.ts";
import { wsPublisher } from "../../websocket/publisher.ts";

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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
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
      const [requester] = await tx
        .select({
          username: users.username,
          displayName: users.displayName,
          avatarKey: users.avatarKey,
        })
        .from(users)
        .where(eq(users.id, normalizedRequesterId))
        .limit(1);

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

      const tokenRows = await tx
        .select({
          deviceToken: userDevices.deviceToken,
        })
        .from(userDevices)
        .where(eq(userDevices.userId, receiver.id));

      return {
        requestResult: inserted,
        pushData: {
          tokens: tokenRows.map((row) => row.deviceToken),
          requesterName: requester.displayName || requester.username || "Someone",
          requesterAvatarKey: requester.avatarKey,
          requesterId: normalizedRequesterId,
        },
      };
    });

    wsPublisher.sendToUser(requestResult.receiverId, {
      type: "NEW_FRIEND_REQUEST" as const,
      payload: requestResult,
    });

    if (pushData.tokens.length > 0) {
      const title = "New Friend Request";
      const body = `${pushData.requesterName} sent you a friend request.`;

      let avatarUrl = "";
      if (pushData.requesterAvatarKey) {
        avatarUrl = await getFileUrl(pushData.requesterAvatarKey);
      }

      const extraData = {
        requesterId: pushData.requesterId,
        avatarUrl,
      };

      void Promise.allSettled(
        pushData.tokens.map((token) =>
          sendPushNotification(token, title, body, "NEW_FRIEND_REQUEST", extraData),
        ),
      ).catch(console.error);
    }

    return requestResult;
  } catch (error) {
    if (error instanceof SendFriendRequestError) {
      throw error;
    }

    if (isPgError(error) && error.code === "23505") {
      throw new SendFriendRequestError("REQUEST_ALREADY_SENT", "Friend request already sent.", 409);
    }

    console.error(`[ERROR] Unexpected error in use case: Send friend request\n${error}`);
    throw new SendFriendRequestError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
