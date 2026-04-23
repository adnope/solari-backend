import { deleteKey, getJson, setJson } from "./json_cache.ts";

export type CachedPostAudienceType = "all" | "selected";
export type CachedPostMediaType = "image" | "video";

export type CachedPostDetail = {
  id: string;
  authorId: string;
  caption: string | null;
  audienceType: CachedPostAudienceType;
  createdAt: string;
  mediaType: CachedPostMediaType;
  objectKey: string;
  thumbnailKey: string | null;
  width: number;
  height: number;
  durationMs: number | null;
};

const POST_DETAIL_CACHE_TTL_SECONDS = 28800;

function getPostDetailCacheKey(postId: string): string {
  return `post-detail:${postId}`;
}

export async function getCachedPostDetail(postId: string): Promise<CachedPostDetail | null> {
  return await getJson<CachedPostDetail>(getPostDetailCacheKey(postId));
}

export async function getCachedPostDetails(
  postIds: string[],
): Promise<Map<string, CachedPostDetail>> {
  const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
  const details = await Promise.all(
    uniquePostIds.map(async (postId) => [postId, await getCachedPostDetail(postId)] as const),
  );

  return new Map(
    details.flatMap(([postId, detail]) => (detail ? [[postId, detail] as const] : [])),
  );
}

export async function cachePostDetail(detail: CachedPostDetail): Promise<void> {
  await setJson(getPostDetailCacheKey(detail.id), detail, POST_DETAIL_CACHE_TTL_SECONDS);
}

export async function cachePostDetails(details: CachedPostDetail[]): Promise<void> {
  await Promise.all(details.map((detail) => cachePostDetail(detail)));
}

export async function deleteCachedPostDetail(postId: string): Promise<void> {
  await deleteKey(getPostDetailCacheKey(postId));
}

export async function deleteCachedPostDetails(postIds: string[]): Promise<void> {
  const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];
  await Promise.all(uniquePostIds.map((postId) => deleteCachedPostDetail(postId)));
}
