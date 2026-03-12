import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import "@std/dotenv/load";

const endpoint = Deno.env.get("S3_ENDPOINT");
const region = Deno.env.get("S3_REGION") || "us-east-1";

const accessKeyId = Deno.env.get("S3_ACCESS_KEY_ID");
const secretAccessKey = Deno.env.get("S3_SECRET_ACCESS_KEY");
export const s3BucketName = Deno.env.get("S3_BUCKET_NAME") || "solari-media";

if (!endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing required S3 environment variables: S3_ENDPOINT, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY",
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
  await s3Client.send(new HeadBucketCommand({ Bucket: s3BucketName }));
  console.log(`[INFO] Connected to S3 Storage at ${endpoint}`);
} catch (_error) {
  console.log(`[INFO] Bucket '${s3BucketName}' not found. Creating it now...`);
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: s3BucketName }));
    console.log(`[INFO] Bucket '${s3BucketName}' created successfully.`);
  } catch (createError) {
    console.error(`[ERROR] Failed to create bucket '${s3BucketName}'.`, createError);
  }
}

export async function uploadFile(
  objectKey: string,
  buffer: Uint8Array,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
    Body: buffer,
    ContentType: contentType,
  });
  await s3Client.send(command);
}

export async function getFileUrl(objectKey: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function deleteFile(objectKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });
  await s3Client.send(command);
}
