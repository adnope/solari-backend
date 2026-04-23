import { and, eq } from "drizzle-orm";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { withTx } from "../../db/client.ts";
import { sessions, userOauthAccounts, userPasswords, users } from "../../db/schema.ts";
import { createAccessToken } from "../../utils/jwt.ts";
import { uploadFile } from "../../storage/s3.ts";
import { AuthError } from "./error_type.ts";
import type { SigninResult } from "./sign_in.ts";
import { REFRESH_TOKEN_TTL_MS } from "./sign_in.ts";

type GoogleTokenPayload = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  aud: string;
};

function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeGoogleUsername(email: string): string {
  let base = email.split("@")[0]!.replace(/[^a-zA-Z0-9_.]/g, "_");
  if (base.length < 4) base = base.padEnd(4, "0");
  if (base.length > 28) base = base.substring(0, 28);
  return base;
}

function generateRandom4Digits(): string {
  return randomInt(1000, 9999).toString();
}

async function downloadAndUploadAvatar(pictureUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pictureUrl);
    if (!res.ok) return null;

    const arrayBuffer = await res.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const contentType = res.headers.get("content-type") || "image/jpeg";

    const avatarKey = `avatars/${Bun.randomUUIDv7()}`;
    await uploadFile(avatarKey, buffer, contentType);
    return avatarKey;
  } catch (error) {
    console.error("[ERROR] Failed to process Google avatar:", error);
    return null;
  }
}

export async function signInWithGoogle(idToken: string): Promise<SigninResult> {
  if (!idToken.trim()) {
    throw new AuthError("INVALID_CREDENTIALS", "Missing Google ID token.", 400);
  }

  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!verifyRes.ok) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid or expired Google token.", 401);
  }

  const payload = (await verifyRes.json()) as GoogleTokenPayload;

  const GOOGLE_CLIENT_ID = process.env["GOOGLE_CLIENT_ID"];
  if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
    throw new AuthError("INVALID_CREDENTIALS", "Token was not issued for this application.", 401);
  }

  try {
    return await withTx(async (tx) => {
      let targetUserId: string;

      const [existingOauth] = await tx
        .select({ userId: userOauthAccounts.userId })
        .from(userOauthAccounts)
        .where(
          and(
            eq(userOauthAccounts.provider, "google"),
            eq(userOauthAccounts.providerUserId, payload.sub),
          ),
        )
        .limit(1);

      if (existingOauth) {
        targetUserId = existingOauth.userId;
      } else {
        const [existingUser] = await tx
          .select({
            id: users.id,
            passwordUserId: userPasswords.userId,
          })
          .from(users)
          .leftJoin(userPasswords, eq(userPasswords.userId, users.id))
          .where(eq(users.email, payload.email.toLowerCase()))
          .limit(1);

        if (existingUser) {
          if (existingUser.passwordUserId) {
            throw new AuthError(
              "EMAIL_TAKEN",
              "Email is already tied to a password-created account. Please sign in with your password.",
              409,
            );
          }

          targetUserId = existingUser.id;
          await tx.insert(userOauthAccounts).values({
            id: Bun.randomUUIDv7(),
            userId: targetUserId,
            provider: "google",
            providerUserId: payload.sub,
          });
        } else {
          targetUserId = Bun.randomUUIDv7();

          let username = sanitizeGoogleUsername(payload.email);
          let usernameTaken = true;

          while (usernameTaken) {
            const [conflict] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.username, username))
              .limit(1);

            if (conflict) {
              username = `${sanitizeGoogleUsername(payload.email)}${generateRandom4Digits()}`;
            } else {
              usernameTaken = false;
            }
          }

          const avatarKey = payload.picture ? await downloadAndUploadAvatar(payload.picture) : null;

          await tx.insert(users).values({
            id: targetUserId,
            username,
            email: payload.email.toLowerCase(),
            displayName: payload.name || null,
            avatarKey,
          });

          await tx.insert(userOauthAccounts).values({
            id: Bun.randomUUIDv7(),
            userId: targetUserId,
            provider: "google",
            providerUserId: payload.sub,
          });
        }
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString();
      const sessionId = Bun.randomUUIDv7();
      const refreshToken = generateSecureToken();
      const refreshTokenHash = sha256Hex(refreshToken);

      await tx.insert(sessions).values({
        id: sessionId,
        userId: targetUserId,
        refreshTokenHash,
        createdAt: nowIso,
        lastUsedAt: nowIso,
        expiresAt,
      });

      const accessToken = createAccessToken({
        sub: targetUserId,
        sid: sessionId,
        type: "access",
      });

      return {
        sessionId,
        accessToken,
        refreshToken,
        expiresAt,
        signInMethod: "google",
      };
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error(`[ERROR] Unexpected error in use case: Sign in with Google\n${error}`);
    throw new AuthError("INTERNAL_ERROR", "Failed to authenticate with Google.", 500);
  }
}
