import { deleteKey, getJson, setJson } from "./json_cache.ts";

export type CachedPublicProfile = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

const PUBLIC_PROFILE_CACHE_TTL_SECONDS = 600;

function getPublicProfileCacheKey(username: string): string {
  return `public-profile:${username.trim().toLowerCase()}`;
}

export async function getCachedPublicProfile(
  username: string,
): Promise<CachedPublicProfile | null> {
  return await getJson<CachedPublicProfile>(getPublicProfileCacheKey(username));
}

export async function cachePublicProfile(profile: CachedPublicProfile): Promise<void> {
  await setJson(
    getPublicProfileCacheKey(profile.username),
    profile,
    PUBLIC_PROFILE_CACHE_TTL_SECONDS,
  );
}

export async function deleteCachedPublicProfile(username: string): Promise<void> {
  await deleteKey(getPublicProfileCacheKey(username));
}
