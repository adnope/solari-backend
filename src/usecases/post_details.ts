import { eq, inArray } from "drizzle-orm";
import {
  cachePostDetail,
  cachePostDetails,
  getCachedPostDetail,
  getCachedPostDetails,
  type CachedPostAudienceType,
  type CachedPostDetail,
  type CachedPostMediaType,
} from "../cache/post_detail_cache.ts";
import { db } from "../db/client.ts";
import { postMedia, posts } from "../db/schema.ts";

export type PostDetail = CachedPostDetail;

type PostDetailRow = {
  id: string;
  authorId: string;
  caption: string | null;
  captionType: string;
  captionMetadata: any;
  audienceType: string;
  createdAt: string;
  mediaType: string;
  objectKey: string;
  thumbnailKey: string | null;
  width: number;
  height: number;
  durationMs: number | null;
};

function normalizeAudienceType(value: string): CachedPostAudienceType {
  switch (value) {
    case "all":
    case "selected":
      return value;
    default:
      throw new Error(`Unexpected post audience type '${value}'.`);
  }
}

function normalizeMediaType(value: string): CachedPostMediaType {
  switch (value) {
    case "image":
    case "video":
      return value;
    default:
      throw new Error(`Unexpected post media type '${value}'.`);
  }
}

function toPostDetail(row: PostDetailRow): PostDetail {
  return {
    id: row.id,
    authorId: row.authorId,
    caption: row.caption,
    captionType: row.captionType,
    captionMetadata: row.captionMetadata,
    audienceType: normalizeAudienceType(row.audienceType),
    createdAt: row.createdAt,
    mediaType: normalizeMediaType(row.mediaType),
    objectKey: row.objectKey,
    thumbnailKey: row.thumbnailKey,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
  };
}

async function fetchPostDetailsByIds(postIds: string[]): Promise<PostDetail[]> {
  if (postIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: posts.id,
      authorId: posts.authorId,
      caption: posts.caption,
      captionType: posts.captionType,
      captionMetadata: posts.captionMetadata,
      audienceType: posts.audienceType,
      createdAt: posts.createdAt,
      mediaType: postMedia.mediaType,
      objectKey: postMedia.objectKey,
      thumbnailKey: postMedia.thumbnailKey,
      width: postMedia.width,
      height: postMedia.height,
      durationMs: postMedia.durationMs,
    })
    .from(posts)
    .innerJoin(postMedia, eq(postMedia.postId, posts.id))
    .where(inArray(posts.id, postIds));

  return rows.map(toPostDetail);
}

export async function getPostDetailById(postId: string): Promise<PostDetail | null> {
  const cached = await getCachedPostDetail(postId);
  if (cached) {
    return cached;
  }

  const [detail] = await fetchPostDetailsByIds([postId]);
  if (!detail) {
    return null;
  }

  await cachePostDetail(detail);
  return detail;
}

export async function getPostDetailsByIds(postIds: string[]): Promise<Map<string, PostDetail>> {
  const uniquePostIds = [...new Set(postIds.map((id) => id.trim()).filter(Boolean))];

  if (uniquePostIds.length === 0) {
    return new Map();
  }

  const cachedDetails = await getCachedPostDetails(uniquePostIds);
  const detailMap = new Map<string, PostDetail>();
  const postIdsToFetch: string[] = [];

  for (const postId of uniquePostIds) {
    const cachedDetail = cachedDetails.get(postId);

    if (cachedDetail) {
      detailMap.set(postId, cachedDetail);
    } else {
      postIdsToFetch.push(postId);
    }
  }

  if (postIdsToFetch.length === 0) {
    return detailMap;
  }

  const fetchedDetails = await fetchPostDetailsByIds(postIdsToFetch);

  for (const detail of fetchedDetails) {
    detailMap.set(detail.id, detail);
  }

  await cachePostDetails(fetchedDetails);

  return detailMap;
}
