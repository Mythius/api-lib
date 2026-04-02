import { join } from "path";
import type { Context } from "hono";

const UPLOADS_DIR = "./uploads";

await Bun.write(join(UPLOADS_DIR, ".gitkeep"), "").catch(() => {});

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
