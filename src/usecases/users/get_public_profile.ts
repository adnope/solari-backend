import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { withDb } from "../../db/postgres_client.ts";
import { getFileUrl } from "../../storage/minio.ts";

export type PublicProfileResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

export class GetPublicProfileError extends Error {
  readonly statusCode: ContentfulStatusCode;
  constructor(message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "GetPublicProfileError";
    this.statusCode = statusCode;
  }
}

export async function getPublicProfile(username: string): Promise<PublicProfileResult> {
  const normalizedUsername = username.trim().toLowerCase();

  if (!normalizedUsername) {
    throw new GetPublicProfileError("Username is required.", 400);
  }

  try {
    const user = await withDb(async (client) => {
      const result = await client.queryObject<{
        id: string;
        username: string;
        display_name: string | null;
        avatar_key: string | null;
      }>`
        SELECT id, username, display_name, avatar_key
        FROM users
        WHERE lower(username) = ${normalizedUsername}
        LIMIT 1
      `;
      return result.rows[0];
    });

    if (!user) {
      throw new GetPublicProfileError("User not found.", 404);
    }

    let avatarUrl: string | null = null;
    if (user.avatar_key) {
      avatarUrl = await getFileUrl(user.avatar_key);
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      avatarUrl,
    };
  } catch (error) {
    if (error instanceof GetPublicProfileError) throw error;
    throw new GetPublicProfileError("Internal server error fetching profile.", 500);
  }
}
