import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { promises as fs } from "fs";
import path from "path";

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
const localEvidenceDir =
  process.env.LOCAL_EVIDENCE_DIR ??
  path.join(process.cwd(), "storage", "evidence");

async function ensureBucketExists() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function saveLocalEvidence(params: {
  key: string;
  body: Buffer;
}): Promise<{ key: string; url: string | undefined }> {
  const filePath = path.join(localEvidenceDir, ...params.key.split("/"));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, params.body);
  return { key: params.key, url: undefined };
}

export async function uploadEvidenceObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  if (!bucket) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("S3_BUCKET is not configured");
    }
    return saveLocalEvidence(params);
  }
  try {
    await ensureBucketExists();

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      return saveLocalEvidence(params);
    }
    throw error;
  }

  const fileUrl = publicBaseUrl
    ? `${publicBaseUrl.replace(/\/$/, "")}/${bucket}/${params.key}`
    : undefined;

  return { key: params.key, url: fileUrl };
}
