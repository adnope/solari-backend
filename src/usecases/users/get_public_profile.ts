import { sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";

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

export async function getPublicProfile(username: string): Promise<PublicProfileResult> {
  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername) {
    throw new GetPublicProfileError("INVALID_INPUT", "Username is required.", 400);
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

    let avatarUrl: string | null = null;
    if (user.avatarKey) {
      avatarUrl = await getFileUrl(user.avatarKey);
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl,
    };
  } catch (error) {
    if (error instanceof GetPublicProfileError) throw error;

    throw new GetPublicProfileError(
      "INTERNAL_ERROR",
      "Internal server error fetching profile.",
      500,
    );
  }
}
