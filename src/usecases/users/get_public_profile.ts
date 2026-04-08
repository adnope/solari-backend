import { sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { isBlockedBy, getNickname } from "../common_queries.ts";

export type PublicProfileResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type GetPublicProfileErrorType = "INVALID_INPUT" | "USER_NOT_FOUND" | "INTERNAL_ERROR";

export class GetPublicProfileError extends Error {
  readonly type: GetPublicProfileErrorType;
  readonly statusCode: number;

  constructor(type: GetPublicProfileErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "GetPublicProfileError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function getPublicProfile(
  requesterId: string,
  username: string,
): Promise<PublicProfileResult> {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedRequesterId = requesterId.trim();

  if (!normalizedUsername || !normalizedRequesterId) {
    throw new GetPublicProfileError(
      "INVALID_INPUT",
      "Requester ID and Username are required.",
      400,
    );
  }

  try {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
      })
      .from(users)
      .where(sql`lower(${users.username}) = ${normalizedUsername}`)
      .limit(1);

    if (!user) {
      throw new GetPublicProfileError("USER_NOT_FOUND", "User not found.", 404);
    }

    const [isBlocked, nickname, avatarUrl] = await Promise.all([
      isBlockedBy(user.id, normalizedRequesterId),
      getNickname(normalizedRequesterId, user.id),
      user.avatarKey ? getFileUrl(user.avatarKey) : Promise.resolve(null),
    ]);

    if (isBlocked) {
      throw new GetPublicProfileError("USER_NOT_FOUND", "User not found.", 404);
    }

    return {
      id: user.id,
      username: user.username,
      displayName: nickname ?? user.displayName,
      avatarUrl,
    };
  } catch (error: unknown) {
    if (error instanceof GetPublicProfileError) throw error;

    console.error(`[ERROR] Unexpected error in use case: Get public profile\n`, error);
    throw new GetPublicProfileError(
      "INTERNAL_ERROR",
      "Internal server error fetching profile.",
      500,
    );
  }
}
