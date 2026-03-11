import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import "@std/dotenv/load";

const host = Deno.env.get("MINIO_HOST") || "localhost";
const port = Deno.env.get("MINIO_PORT") || "9000";
const endpoint = `http://${host}:${port}`;
const region = "us-east-1";

const accessKeyId = Deno.env.get("MINIO_ROOT_USER");
const secretAccessKey = Deno.env.get("MINIO_ROOT_PASSWORD");
export const minioBucketName = Deno.env.get("MINIO_BUCKET_NAME") || "solari-media";

if (!accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing required MinIO environment variables: MINIO_ROOT_USER or MINIO_ROOT_PASSWORD",
  );
}

export const s3Client = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});

try {
  await s3Client.send(new HeadBucketCommand({ Bucket: minioBucketName }));
  console.log(`[INFO] Connected to MinIO S3 at ${endpoint}`);
} catch (error) {
  console.error(`[ERROR] Failed to connect to MinIO at ${endpoint}. Does the bucket exist?`, error);
}

export async function uploadFile(
  objectKey: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: minioBucketName,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
}

export async function getFileUrl(objectKey: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: minioBucketName,
    Key: objectKey,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function deleteFile(objectKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: minioBucketName,
    Key: objectKey,
  });
  await s3Client.send(command);
}
