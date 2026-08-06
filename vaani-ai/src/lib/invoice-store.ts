import { s3, RECORDINGS_BUCKET, ensureBucket } from "./storage";

/** Store the rendered invoice HTML (browser print → PDF; wkhtmltopdf optional). */
export async function putInvoiceHtml(key: string, html: string): Promise<void> {
  await ensureBucket();
  const buf = Buffer.from(html, "utf8");
  await s3.putObject(RECORDINGS_BUCKET, key, buf, buf.length, {
    "Content-Type": "text/html",
  });
}

/** Presigned URL to download the stored invoice HTML (15 min). */
export async function invoiceFileUrl(key: string): Promise<string> {
  await ensureBucket();
  return s3.presignedGetObject(RECORDINGS_BUCKET, key, 15 * 60);
}
