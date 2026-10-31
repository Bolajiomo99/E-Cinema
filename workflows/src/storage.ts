// Cloudflare R2 (S3-compatible) storage for generated media.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

function s3(): S3Client {
  const endpoint = process.env.R2_ENDPOINT, accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new Error("R2 storage is not configured");
  client ??= new S3Client({ region: "auto", endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  return client;
}

export const bucket = () => process.env.R2_BUCKET ?? "e-cinema-media";

export async function put(key: string, body: Uint8Array | string, contentType: string): Promise<string> {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
  return key;
}
