import { Elysia } from "elysia";
import { eq, and, gt } from "drizzle-orm";
import { verifyAccessToken } from "../../lib/jwt.ts";
import { db } from "../../db/client.ts";
import { sessions } from "../../db/schema.ts";

export class AuthorizationError extends Error {
  public status = 401;

  constructor(message: string) {
    super(message);
  }
}

export const requireAuth = new Elysia({ name: "require-auth" })
  .error({ AuthorizationError })
  .resolve({ as: "scoped" }, async ({ headers }) => {
    const authHeader = headers["authorization"];

    if (!authHeader) {
      throw new AuthorizationError("Missing Authorization header.");
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new AuthorizationError("Invalid Authorization header format.");
    }

    let payload: ReturnType<typeof verifyAccessToken>;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new AuthorizationError("Invalid or expired access token.");
    }

    const [session] = await db
      .select({
        id: sessions.id,
        userId: sessions.userId,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, payload.sid),
          eq(sessions.userId, payload.sub),
          gt(sessions.expiresAt, new Date().toISOString()),
        ),
      )
      .limit(1);

    if (!session) {
      throw new AuthorizationError("Session not found or expired.");
    }

    return {
      authUserId: session.userId,
      authSessionId: session.id,
    };
  });
