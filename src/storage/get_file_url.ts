import { RedisClient } from "bun";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type CreateGetFileUrlOptions = {
  bucketName: string;
  presignClient: S3Client;
  region: string;
  presignEndpoint: string | undefined;
  forcePathStyle: boolean;
  accessKeyId: string;
  redisUrl: string;
};

export type GetFileUrl = (objectKey: string, expiresInSeconds?: number) => Promise<string>;

export function createGetFileUrl({
  bucketName,
  presignClient,
  region,
  presignEndpoint,
  forcePathStyle,
  accessKeyId,
  redisUrl,
}: CreateGetFileUrlOptions): GetFileUrl {
  const presignedUrlCache = new RedisClient(redisUrl);
  let lastPresignedUrlCacheWarningAt = 0;

  function encodeCacheKeyPart(value: string): string {
    return Buffer.from(value).toString("base64url");
  }

  function getPresignedUrlCacheKey(objectKey: string, expiresInSeconds: number): string {
    return [
      "s3-presigned-url",
      "v1",
      encodeCacheKeyPart(bucketName),
      encodeCacheKeyPart(objectKey),
      expiresInSeconds.toString(),
      encodeCacheKeyPart(region),
      encodeCacheKeyPart(presignEndpoint || "aws-default-endpoint"),
      forcePathStyle ? "path-style" : "virtual-hosted-style",
      encodeCacheKeyPart(accessKeyId),
    ].join(":");
  }

  function warnPresignedUrlCacheFailure(message: string, error: unknown): void {
    const now = Date.now();
    if (now - lastPresignedUrlCacheWarningAt < 30000) {
      return;
    }

    lastPresignedUrlCacheWarningAt = now;
    console.warn(message, error);
  }

  async function getCachedPresignedUrl(cacheKey: string): Promise<string | null> {
    try {
      return await presignedUrlCache.get(cacheKey);
    } catch (error) {
      warnPresignedUrlCacheFailure("[WARN] Failed to read cached S3 presigned URL:", error);
      return null;
    }
  }

  async function cachePresignedUrl(
    cacheKey: string,
    url: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (ttlSeconds <= 0) {
      return;
    }

    try {
      await presignedUrlCache.set(cacheKey, url, "EX", ttlSeconds);
    } catch (error) {
      warnPresignedUrlCacheFailure("[WARN] Failed to cache S3 presigned URL:", error);
    }
  }

  return async function getFileUrl(objectKey: string, expiresInSeconds = 3600): Promise<string> {
    const normalizedObjectKey = objectKey.trim();
    if (!normalizedObjectKey) {
      throw new Error("S3 object key must not be empty.");
    }

    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error(`Invalid presigned URL expiry '${expiresInSeconds}'.`);
    }
    const normalizedExpiresInSeconds = Math.floor(expiresInSeconds);

    const cacheTtlSeconds = Math.floor(
      normalizedExpiresInSeconds <= 10 ? 0 : normalizedExpiresInSeconds * 0.9,
    );

    const cacheKey = getPresignedUrlCacheKey(normalizedObjectKey, normalizedExpiresInSeconds);

    if (cacheTtlSeconds > 0) {
      const cachedUrl = await getCachedPresignedUrl(cacheKey);
      if (cachedUrl) {
        return cachedUrl;
      }
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: normalizedObjectKey,
    });

    const url = await getSignedUrl(presignClient, command, {
      expiresIn: normalizedExpiresInSeconds,
    });
    await cachePresignedUrl(cacheKey, url, cacheTtlSeconds);

    return url;
  };
}
