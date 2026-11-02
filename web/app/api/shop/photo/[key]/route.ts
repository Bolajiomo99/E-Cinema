import { mediaEnabled, objectBytes } from "@/lib/media";

// GET: a shop product photo. Public, like the shop itself; only keys the add-product form made.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key) || !mediaEnabled) return new Response("Not found", { status: 404 });
  const obj = await objectBytes(`shop/${key}`).catch(() => null);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(obj.body), { headers: { "content-type": obj.type, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
