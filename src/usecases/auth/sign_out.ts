import { and, eq } from "drizzle-orm";
import { withTx } from "../../db/client.ts";
import { sessions, userDevices } from "../../db/schema.ts";
import { AuthError } from "./error_type.ts";

export async function signOut(sessionId: string, deviceToken?: string): Promise<boolean> {
  const normalizedSessionId = sessionId.trim();

  if (!normalizedSessionId) {
    throw new AuthError("MISSING_SESSION_ID", "Session id is missing.", 400);
  }

  try {
    return await withTx(async (tx) => {
      const [deletedSession] = await tx
        .delete(sessions)
        .where(eq(sessions.id, normalizedSessionId))
        .returning({
          id: sessions.id,
          userId: sessions.userId,
        });

      if (!deletedSession) {
        throw new AuthError("SESSION_NOT_FOUND", "Session not found.", 404);
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
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
