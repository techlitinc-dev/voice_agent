/**
 * Upload a pre-recorded audio file (mp3/wav) to MinIO bucket "vaani-assets" and print
 * its public URL — for hybrid pre-recorded + TTS agents (readme §4.2).
 * Usage: npx tsx scripts/upload-prerecorded.ts ./audio/disclosure-en.mp3
 */
import { Client } from "minio";
import { basename } from "node:path";
import { statSync } from "node:fs";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx scripts/upload-prerecorded.ts <file.mp3|file.wav>");
    process.exit(1);
  }
  statSync(file); // throws if the file does not exist

  const endpoint = new URL(process.env.S3_ENDPOINT ?? "http://localhost:9000");
  const client = new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.S3_ACCESS_KEY ?? "",
    secretKey: process.env.S3_SECRET_KEY ?? "",
  });

  const BUCKET = "vaani-assets";
  const key = `prerecorded/${Date.now()}-${basename(file)}`;

  const exists = await client.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await client.makeBucket(BUCKET);
    // Public read: Dograh must be able to fetch the audio by URL.
    await client.setBucketPolicy(
      BUCKET,
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${BUCKET}/*`],
          },
        ],
      })
    );
  }
  await client.fPutObject(BUCKET, key, file);
  const base = (process.env.S3_ENDPOINT ?? "http://localhost:9000").replace(/\/$/, "");
  console.log(`uploaded: ${BUCKET}/${key}`);
  console.log(`public url: ${base}/${BUCKET}/${key}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
