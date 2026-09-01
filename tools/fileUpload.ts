import { join } from "path";
import type { Context } from "hono";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const UPLOADS_DIR = "./uploads";

await Bun.write(join(UPLOADS_DIR, ".gitkeep"), "").catch(() => {});

// Lazily initialised so missing S3 env vars don't crash local-only dev.
let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return _s3;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

// Allow-list/size check for small image uploads (avatars, logos, etc.) —
// returns an error message, or null if the file is valid.
export function validateImageUpload(file: File, maxSize = 5 * 1024 * 1024): string | null {
  if (!IMAGE_TYPES.has(file.type)) return "Image must be PNG, JPEG, WEBP, or SVG";
  if (file.size > maxSize) return `Image must be under ${Math.round(maxSize / (1024 * 1024))}MB`;
  return null;
}

// Stores a public-facing asset and returns a browser-servable URL. `key` is a
// relative path such as "org-logos/12-abc123.png". Set STORAGE_PROVIDER=local
// to write to ./uploads instead of S3 (e.g. for local dev without a bucket).
export async function storeAsset(file: File, key: string): Promise<string> {
  if (process.env.STORAGE_PROVIDER === "local") {
    await Bun.write(join(UPLOADS_DIR, key), file);
    return `/uploads/${key}`;
  }

  await getS3().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type,
    }),
  );
  // S3_PUBLIC_URL should point at a publicly readable base (e.g. an R2/CDN
  // custom domain). Falls back to S3_ENDPOINT, which only works if the bucket
  // is exposed at that host.
  const base = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT;
  return `${base}/${process.env.S3_BUCKET}/${key}`;
}

export async function handleFileUpload(c: Context, name?: string): Promise<{
  filename: string;
  originalName: string;
  size: number;
  type: string;
  path: string;
} | { error: string }> {
  const formData = await c.req.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return { error: "No file provided. Send a multipart/form-data request with a 'file' field." };
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const filename = (name ?? crypto.randomUUID()) + ext;
  const dest = join(UPLOADS_DIR, filename);

  await Bun.write(dest, file);

  return {
    filename,
    originalName: file.name,
    size: file.size,
    type: file.type,
    path: dest,
  };
}
