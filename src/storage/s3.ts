import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createGetFileUrl } from "./get_file_url.ts";

const endpoint = process.env["S3_ENDPOINT"]?.trim();
const presignEndpoint = process.env["S3_PRESIGN_ENDPOINT"]?.trim() || endpoint;
const region = process.env["S3_REGION"] || "us-east-1";
const forcePathStyle = process.env["S3_FORCE_PATH_STYLE"] === "true";
const createBucketIfMissing = process.env["S3_CREATE_BUCKET_IF_MISSING"] === "true";
const redisHost = process.env["REDIS_HOST"] || "localhost";
const redisPort = process.env["REDIS_PORT"] || "6379";
const redisUrl = `redis://${redisHost}:${redisPort}`;

const configuredAccessKeyId = process.env["S3_ACCESS_KEY_ID"];
const configuredSecretAccessKey = process.env["S3_SECRET_ACCESS_KEY"];
const configuredBucketName = process.env["S3_BUCKET_NAME"];

if (!configuredBucketName || !configuredAccessKeyId || !configuredSecretAccessKey) {
  throw new Error(
    "Missing required S3 environment variables: S3_BUCKET_NAME, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY",
  );
}

const accessKeyId = configuredAccessKeyId;
const secretAccessKey = configuredSecretAccessKey;
export const s3BucketName = configuredBucketName;

const credentials = { accessKeyId, secretAccessKey };

const baseClientConfig: S3ClientConfig = {
  region,
  credentials,
  forcePathStyle,
};

export const s3Client = new S3Client({
  ...baseClientConfig,
  ...(endpoint ? { endpoint } : {}),
});

const presignClient = new S3Client({
  ...baseClientConfig,
  ...(presignEndpoint ? { endpoint: presignEndpoint } : {}),
});

try {
  await s3Client.send(new HeadBucketCommand({ Bucket: s3BucketName }));
  console.log(`[INFO] Connected to S3 bucket '${s3BucketName}'.`);
} catch (error) {
  if (!createBucketIfMissing) {
    console.error(`[ERROR] Failed to access S3 bucket '${s3BucketName}'.`, error);
    process.exit(1);
  }

  console.log(`[INFO] S3 bucket '${s3BucketName}' is not accessible. Creating it now...`);
  try {
    await s3Client.send(new CreateBucketCommand({ Bucket: s3BucketName }));
    console.log(`[INFO] Bucket '${s3BucketName}' created successfully.`);
    console.log(`[INFO] Connected to S3 bucket '${s3BucketName}'.`);
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

export const getFileUrl = createGetFileUrl({
  bucketName: s3BucketName,
  presignClient,
  region,
  presignEndpoint,
  forcePathStyle,
  accessKeyId,
  redisUrl,
});

export async function deleteFile(objectKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });
  await s3Client.send(command);
}

export async function getUploadPresignedUrl(
  objectKey: string,
  contentType: string,
  expiresInSeconds = 180,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  return await getSignedUrl(presignClient, command, { expiresIn: expiresInSeconds });
}

export async function getFileBuffer(objectKey: string): Promise<Uint8Array> {
  const command = new GetObjectCommand({
    Bucket: s3BucketName,
    Key: objectKey,
  });

  const response = await s3Client.send(command);

  if (!response.Body) {
    throw new Error("Empty file body received from S3.");
  }

  return new Uint8Array(await response.Body.transformToByteArray());
}
