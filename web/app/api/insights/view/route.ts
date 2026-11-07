import { FILM_ID } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { recordView } from "@/lib/views";

// POST /api/insights/view {film}: the film page says it was opened.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const b = (await req.json().catch(() => ({}))) as { film?: unknown };
  const film = typeof b.film === "string" ? b.film : "";
  // The API only counts films it has, so studio premieres published a moment ago count too.
  if (!FILM_ID.test(film)) return json(404, { error: "Unknown film" });
  await recordView(req, film, "page");
  return json(204, null);
}
