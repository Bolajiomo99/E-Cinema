import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { quizFor, quizPrize } from "@/lib/quiz";

// The lobby quiz: GET gives the questions without answers; POST checks all five at once, one try per premiere.
export const dynamic = "force-dynamic";
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function gate(showtime: string) {
  const s = findShowtime(showtime);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!s || !session) return { error: json(!s ? 404 : 401, { error: !s ? "No such premiere" : "Sign in first" }) };
  const room = await accountApi("GET", `/v1/rooms/${encodeURIComponent(s.id)}`, undefined, session);
  if (room.status !== 200 || !(room.body as { hasTicket?: boolean }).hasTicket) return { error: json(403, { error: "The quiz is for ticket holders" }) };
  return { s, session };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate((await params).id);
  if (g.error) return g.error;
  const done = await accountApi("GET", `/v1/me/quiz/${encodeURIComponent(g.s.id)}`, undefined, g.session);
  const qs = quizFor(g.s);
  return json(200, { questions: qs.map(({ q, options }) => ({ q, options })), prizeCents: quizPrize(g.s), done: (done.body as { done?: unknown })?.done ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return json(403, { error: "forbidden" });
  const g = await gate((await params).id);
  if (g.error) return g.error;
  if (Date.now() >= Date.parse(g.s.startsAt)) return json(409, { error: "The quiz closes when the film starts" });
  const me = await currentAccount();
  if (!me) return json(401, { error: "Sign in first" });
  const qs = quizFor(g.s);
  if (qs.length < 5) return json(404, { error: "No quiz for this premiere" });
  const { answers } = (await req.json().catch(() => ({}))) as { answers?: number[] };
  if (!Array.isArray(answers) || answers.length !== qs.length) return json(400, { error: "Answer all five questions" });
  const score = qs.filter((q, i) => answers[i] === q.answer).length;
  const r = await accountApi("POST", "/v1/internal/quiz", { accountId: me.id, showtimeId: g.s.id, score, prizeCents: quizPrize(g.s) });
  if (r.status !== 200) return json(r.status, r.body ?? {});
  const out = r.body as { score: number; prizeCents: number; already: boolean };
  // Answers are only revealed after the one try is recorded.
  return json(200, { ...out, correct: qs.map((q) => q.answer) });
}
