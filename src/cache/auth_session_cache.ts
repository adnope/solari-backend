import { getJson, setJson, deleteKey } from "./json_cache.ts";

export type CachedAuthSession = {
  sessionId: string;
  userId: string;
  expiresAt: string;
};

const AUTH_SESSION_MAX_TTL_SECONDS = 600;

function getAuthSessionCacheKey(sessionId: string): string {
  return `auth-session:${sessionId}`;
}

function getTtlSeconds(expiresAt: string): number {
  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = Date.now();

  if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs) {
    return 0;
  }

  const secondsUntilSessionExpiry = Math.floor((expiresAtMs - nowMs) / 1000);
  return Math.min(AUTH_SESSION_MAX_TTL_SECONDS, secondsUntilSessionExpiry);
}

export async function getCachedAuthSession(sessionId: string): Promise<CachedAuthSession | null> {
  const session = await getJson<CachedAuthSession>(getAuthSessionCacheKey(sessionId));

  if (!session) return null;

  const expiresAtMs = new Date(session.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    await deleteCachedAuthSession(sessionId);
    return null;
  }

  return session;
}

export async function cacheAuthSession(session: CachedAuthSession): Promise<void> {
  const ttlSeconds = getTtlSeconds(session.expiresAt);
  await setJson(getAuthSessionCacheKey(session.sessionId), session, ttlSeconds);
}

export async function deleteCachedAuthSession(sessionId: string): Promise<void> {
  await deleteKey(getAuthSessionCacheKey(sessionId));
}

export async function deleteCachedAuthSessions(sessionIds: string[]): Promise<void> {
  const uniqueSessionIds = [...new Set(sessionIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(uniqueSessionIds.map((sessionId) => deleteCachedAuthSession(sessionId)));
}
