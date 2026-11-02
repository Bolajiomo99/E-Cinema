import { mediaEnabled, roomObjectLink } from "@/lib/media";

// The poster of a film a studio has published, for anyone browsing the site.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ upload: string }> }) {
  const { upload } = await ctx.params;
  const base = process.env.API_URL, token = process.env.INTERNAL_API_TOKEN;
  if (!/^[0-9a-f-]{36}$/.test(upload) || !base || !token || !mediaEnabled) return new Response("Not found", { status: 404 });
  const r = await fetch(`${base}/v1/studio-films/${upload}/poster`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).catch(() => null);
  if (!r?.ok) return new Response("Not found", { status: 404 });
  const { key } = (await r.json()) as { key: string };
  return new Response(null, { status: 302, headers: { Location: await roomObjectLink(key), "Cache-Control": "public, max-age=300" } });
}
