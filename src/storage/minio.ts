import { S3Client } from "bun";

const host = process.env.MINIO_HOST || "localhost";
const port = process.env.MINIO_PORT || "9000";
const endpoint = `http://${host}:${port}`;
const region = "us-east-1";

const accessKeyId = process.env.MINIO_ROOT_USER;
const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
export const minioBucketName = process.env.MINIO_BUCKET_NAME || "solari-media";

if (!accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing required MinIO environment variables: MINIO_ROOT_USER or MINIO_ROOT_PASSWORD",
  );
}

export const s3Client = new S3Client({
  accessKeyId,
  secretAccessKey,
  endpoint,
  region,
  bucket: minioBucketName,
});

try {
  await s3Client.file(".healthcheck").exists();
  console.log(`[INFO] Connected to MinIO S3 at ${endpoint}`);
} catch (error) {
  console.error(`[ERROR] Failed to connect to MinIO at ${endpoint}:`, error);
}

export async function uploadFile(
  objectKey: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<void> {
  const file = s3Client.file(objectKey, { type: contentType });
  await file.write(buffer);
}

export async function getFileUrl(objectKey: string, expiresInSeconds = 3600): Promise<string> {
  const file = s3Client.file(objectKey);
  return file.presign({ expiresIn: expiresInSeconds });
}

export async function deleteFile(objectKey: string): Promise<void> {
  const file = s3Client.file(objectKey);
  await file.delete();
}
