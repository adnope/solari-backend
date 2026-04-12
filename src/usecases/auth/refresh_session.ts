import { eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { sessions } from "../../db/schema.ts";
import { createAccessToken } from "../../utils/jwt.ts";
import { AuthError } from "./error_type.ts";
import { createHash, randomBytes } from "node:crypto";
import type { SigninResult } from "./sign_in.ts";

const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type RefreshSessionInput = {
  refreshToken: string;
};

export async function refreshSession(input: RefreshSessionInput): Promise<SigninResult> {
  const { refreshToken } = input;

  if (!refreshToken.trim()) {
    throw new AuthError("INVALID_CREDENTIALS", "Missing refresh token.", 400);
  }

  const incomingHash = sha256Hex(refreshToken);
  const now = new Date();

  try {
    return await withTx(async (tx) => {
      const [session] = await tx
        .select({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, incomingHash))
        .limit(1);

      if (!session) {
        throw new AuthError("SESSION_NOT_FOUND", "Invalid session or refresh token.", 401);
      }

      if (new Date(session.expiresAt) < now) {
        await tx.delete(sessions).where(eq(sessions.id, session.id));
        throw new AuthError("SESSION_NOT_FOUND", "Session expired. Please sign in again.", 401);
      }

      const newRefreshToken = generateSecureToken();
      const newRefreshTokenHash = sha256Hex(newRefreshToken);
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString();

      await tx
        .update(sessions)
        .set({
          refreshTokenHash: newRefreshTokenHash,
          lastUsedAt: nowIso,
          expiresAt: expiresAt,
        })
        .where(eq(sessions.id, session.id));

      const newAccessToken = createAccessToken({
        sub: session.userId,
        sid: session.id,
        type: "access",
      });

      return {
        sessionId: session.id,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt,
      };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Refresh session\n${error}`);
    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
