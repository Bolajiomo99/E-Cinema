import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { accountApi } from "@/lib/auth";
import { json, roomGate, sameOrigin } from "@/lib/room-gate";
import { aiEnabled, translateChat, type Source } from "@/lib/room-chat";

// World chat in the viewer's own language (Figma 95:1008). Each message is translated once per
// language and kept, so a busy room costs one translation per language, not one per reader.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const g = await roomGate((await params).id);
  if (g instanceof NextResponse) return g;
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const list = Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x) && x > 0).slice(0, 40) : [];
  if (!list.length) return json(200, { lang: g.lang, items: {} });

  const r = await accountApi("POST", `/v1/internal/rooms/${g.s.id}/translations`, { lang: g.lang, ids: list });
  if (r.status !== 200) return json(502, { error: "Translations are unavailable right now" });
  const { done, missing } = r.body as { done: Record<string, string>; missing: Source[] | null };
  const items: Record<string, string> = { ...done };
  const spoilers: number[] = [];
  const todo = (missing ?? []).filter((m) => (m.lang || "").split("-")[0] !== g.lang);
  let paused = false;
  if (todo.length) {
    if (!aiEnabled()) paused = true;
    else {
      try {
        const out = await translateChat(g.s.film, g.lang, todo);
        for (const t of out) {
          items[t.id] = t.body;
          if (t.spoiler) spoilers.push(t.id);
        }
        if (out.length) await accountApi("PUT", `/v1/internal/rooms/${g.s.id}/translations`, { lang: g.lang, items: out });
      } catch (err) {
        console.error("chat translation failed", (err as Error).message);
        paused = true;
      }
    }
  }
  return json(200, { lang: g.lang, items, spoilers, paused });
}
