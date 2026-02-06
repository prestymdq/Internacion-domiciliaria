import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  credentials: process.env.S3_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      }
    : undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

const bucket = process.env.S3_BUCKET ?? "";
const publicBaseUrl = process.env.S3_PUBLIC_URL ?? "";

export async function uploadEvidenceObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  if (!bucket) {
    throw new Error("S3_BUCKET is not configured");
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );

  const fileUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, "")}/${bucket}/${params.key}`
    : undefined;

  return { key: params.key, url: fileUrl };
}
