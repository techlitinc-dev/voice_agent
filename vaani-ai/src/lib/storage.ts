import * as Minio from "minio";

const ENDPOINT = new URL(process.env.S3_ENDPOINT ?? "http://localhost:9000");

export const s3 = new Minio.Client({
  endPoint: ENDPOINT.hostname,
  port: Number(ENDPOINT.port || 9000),
  useSSL: ENDPOINT.protocol === "https:",
  accessKey: process.env.S3_ACCESS_KEY ?? "",
  secretKey: process.env.S3_SECRET_KEY ?? "",
});

export const RECORDINGS_BUCKET = process.env.S3_BUCKET_RECORDINGS ?? "vaani-recordings";
export const KB_BUCKET = process.env.S3_BUCKET_KB ?? "vaani-knowledge";

const bootstrapped = new Set<string>();

export async function ensureBucket(bucket: string = RECORDINGS_BUCKET) {
  if (bootstrapped.has(bucket)) return;
  const exists = await s3.bucketExists(bucket).catch(() => false);
  if (!exists) await s3.makeBucket(bucket);
  bootstrapped.add(bucket);
}

/** Upload a buffer to any bucket; returns the storage key used. */
export async function putObject(
  bucket: string,
  key: string,
  buf: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket(bucket);
  await s3.putObject(bucket, key, buf, buf.length, { "Content-Type": contentType });
  return key;
}

/** Presigned GET URL, valid 15 minutes. */
export async function recordingUrl(key: string): Promise<string> {
  await ensureBucket();
  return s3.presignedGetObject(RECORDINGS_BUCKET, key, 15 * 60);
}

/** Presigned GET for a knowledge-base file (admin preview). */
export async function kbFileUrl(key: string): Promise<string> {
  await ensureBucket(KB_BUCKET);
  return s3.presignedGetObject(KB_BUCKET, key, 15 * 60);
}

/** Download a remote recording (from Dograh/Vobiz URL) and store it in MinIO. */
export async function ingestRecording(sourceUrl: string, key: string): Promise<void> {
  await ensureBucket();
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) throw new Error(`recording fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await s3.putObject(RECORDINGS_BUCKET, key, buf, buf.length, {
    "Content-Type": res.headers.get("content-type") ?? "audio/wav",
  });
}
