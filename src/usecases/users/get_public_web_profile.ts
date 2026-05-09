import { sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { cachePublicProfile, getCachedPublicProfile } from "../../cache/public_profile_cache.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { AppError } from "../app_error.ts";

export type PublicWebProfileResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export type GetPublicWebProfileErrorType = "INVALID_INPUT" | "USER_NOT_FOUND" | "INTERNAL_ERROR";

export async function getPublicWebProfile(username: string): Promise<PublicWebProfileResult> {
  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername) {
    throw new AppError<GetPublicWebProfileErrorType>("INVALID_INPUT", "Username is required.", 400);
  }

  try {
    const cachedProfile = await getCachedPublicProfile(normalizedUsername);

    if (cachedProfile) {
      return cachedProfile;
    }

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
      throw new AppError<GetPublicWebProfileErrorType>("USER_NOT_FOUND", "User not found.", 404);
    }

    const profile = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarKey ? await getFileUrl(user.avatarKey) : null,
    };

    await cachePublicProfile(profile);

    return profile;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Get public web profile\n`, error);
    throw new AppError<GetPublicWebProfileErrorType>(
      "INTERNAL_ERROR",
      "Internal server error fetching profile.",
      500,
    );
  }
}
