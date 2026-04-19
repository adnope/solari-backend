import { Elysia } from "elysia";
import { eq, and, gt } from "drizzle-orm";
import { verifyAccessToken } from "../../utils/jwt.ts";
import { db } from "../../db/client.ts";
import { sessions } from "../../db/schema.ts";
import {
  getCachedAuthSession,
  cacheAuthSession,
  type CachedAuthSession,
} from "../../cache/auth_session_cache.ts";

export class AuthorizationError extends Error {
  public status = 401;

  constructor(message: string) {
    super(message);
  }
}

async function getValidSession(
  sessionId: string,
  userId: string,
): Promise<CachedAuthSession | null> {
  const cached = await getCachedAuthSession(sessionId);

  if (cached && cached.userId === userId) {
    return cached;
  }

  const [session] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!session) {
    return null;
  }

  await cacheAuthSession(session);
  return session;
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

    const session = await getValidSession(payload.sid, payload.sub);

    if (!session) {
      throw new AuthorizationError("Session not found or expired.");
    }

    return {
      authUserId: session.userId,
      authSessionId: session.sessionId,
    };
  });
