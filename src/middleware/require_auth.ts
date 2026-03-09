import { createMiddleware } from "hono/factory";
import { verifyAccessToken } from "../lib/jwt.ts";
import { withDb } from "../db/postgres_client.ts";

export type AuthVariables = {
  authUserId: string;
  authSessionId: string;
};

export const requireAuth = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    return c.json({ error: "Missing Authorization header." }, 401);
  }

  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return c.json({ error: "Invalid Authorization header format." }, 401);
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return c.json({ error: "Invalid or expired access token." }, 401);
  }

  const session = await withDb(async (client) => {
    const result = await client`
      SELECT id, user_id
      FROM sessions
      WHERE id = ${payload.sid}
        AND user_id = ${payload.sub}
        AND expires_at > now()
      LIMIT 1
    `;

    return result[0] ?? null;
  });

  if (!session) {
    return c.json({ error: "Session not found or expired." }, 401);
  }

  c.set("authUserId", session.user_id);
  c.set("authSessionId", session.id);

  await next();
});
