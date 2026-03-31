import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const internalEndpoint = process.env["S3_ENDPOINT"];
const publicEndpoint = process.env["S3_PUBLIC_ENDPOINT"] || internalEndpoint;
const region = process.env["S3_REGION"] || "us-east-1";

const accessKeyId = process.env["S3_ACCESS_KEY_ID"];
const secretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
export const s3BucketName = process.env["S3_BUCKET_NAME"] || "solari-media";

if (!internalEndpoint || !accessKeyId || !secretAccessKey) {
  throw new Error(
    "Missing required S3 environment variables: S3_ENDPOINT, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY",
  );
}

const credentials = { accessKeyId, secretAccessKey };

export const s3Client = new S3Client({
  endpoint: internalEndpoint,
  region,
  credentials,
  forcePathStyle: true,
});

const presignClient = new S3Client({
  endpoint: publicEndpoint ?? internalEndpoint,
  region,
  credentials,
  forcePathStyle: true,
});

try {
  await s3Client.send(new HeadBucketCommand({ Bucket: s3BucketName }));
  console.log(`[INFO] Connected to S3 Storage at ${internalEndpoint}`);
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
  buffer: Uint8Array | Buffer,
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

  return await getSignedUrl(presignClient, command, { expiresIn: expiresInSeconds });
}

export async function deleteFile(objectKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });
  await s3Client.send(command);
}
