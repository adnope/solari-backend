import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { sessions, userDevices } from "../../db/schema.ts";
import type { AuthErrorType } from "./error_type.ts";
import { deleteCachedAuthSession } from "../../cache/auth_session_cache.ts";
import { AppError } from "../app_error.ts";

export async function signOut(sessionId: string, deviceToken?: string): Promise<boolean> {
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    throw new AppError<AuthErrorType>("MISSING_SESSION_ID", "Session id is missing.", 400);
  }

  try {
    const signedOut = await withTx(async (tx) => {
      const [deletedSession] = await tx
        .delete(sessions)
        .where(eq(sessions.id, normalizedSessionId))
        .returning({
          id: sessions.id,
          userId: sessions.userId,
        });

      if (!deletedSession) {
        throw new AppError<AuthErrorType>("SESSION_NOT_FOUND", "Session not found.", 404);
      }

      if (deviceToken) {
        const normalizedToken = deviceToken.trim();

        if (normalizedToken) {
          await tx
            .delete(userDevices)
            .where(
              and(
                eq(userDevices.userId, deletedSession.userId),
                eq(userDevices.deviceToken, normalizedToken),
              ),
            );
        }
      }

      return true;
    });

    await deleteCachedAuthSession(normalizedSessionId);
    return signedOut;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error(`[ERROR] Unexpected error in use case: Sign out\n${error}`);
    throw new AppError<AuthErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
