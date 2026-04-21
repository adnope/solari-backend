import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { getFileUrl } from "../../storage/s3.ts";
import { AuthError } from "./error_type.ts";

export type MeResult = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

export async function me(userId: string): Promise<MeResult> {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) {
    throw new AuthError("MISSING_USER_ID", "User id is missing.", 400);
  }

  try {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        avatarKey: users.avatarKey,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, normalizedUserId))
      .limit(1);

    if (!user) {
      throw new AuthError("USER_NOT_FOUND", "User not found.", 404);
    }

    const avatarUrl = user.avatarKey ? await getFileUrl(user.avatarKey) : null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      avatarUrl,
      createdAt: user.createdAt,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Me\n${error}`);
    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
