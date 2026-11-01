import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import type { Application, Quote } from "@/lib/careers-types";
import { emailEnabled, sendApplicationReceived, sendApplicationUpdate, sendQuoteRequest } from "@/lib/email";
import { mediaEnabled, putRoomObject, roomObjectLink } from "@/lib/media";
import { json, sameOrigin } from "@/lib/room-gate";
import { isStaff } from "@/lib/store";

// Careers (Figma 114:1397, 114:1531): CV upload, applying, withdrawing; the hiring desk; and
// group screening quotes (94:1239). The Go careers API keeps the records.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;
const SLUG = /^[a-z0-9-]{3,80}$/;
const CV_KEY = /^careers\/[0-9a-f-]{36}\.pdf$/;
const pass = (r: { status: number; body: unknown }) => json(r.status === 204 ? 200 : r.status, r.body ?? {});
const hits = new Map<string, number[]>();

function limited(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return true;
  hits.set(key, [...recent, now]);
  if (hits.size > 5000) hits.clear();
  return false;
}

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function staff() {
  const me = await currentAccount();
  return isStaff(me?.email);
}

const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos", timeZoneName: "short" }).format(new Date(iso));

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const p = (await params).path ?? [];
  if (p[0] === "applications") {
    const s = await session();
    if (!s) return json(401, { error: "Sign in first", signIn: true });
    return pass(await accountApi("GET", "/v1/me/applications", undefined, s));
  }
  if (p[0] === "desk") {
    if (!(await staff())) return json(403, { error: "Staff only" });
    // A short-lived link to one applicant's CV.
    if (p[1] === "cv" && UUID.test(p[2] ?? "")) {
      const r = await accountApi("GET", `/v1/careers/applications/${p[2]}`);
      if (r.status !== 200) return pass(r);
      const key = (r.body as Application).cvKey ?? "";
      if (!CV_KEY.test(key) || !mediaEnabled) return json(404, { error: "No CV on file" });
      return Response.redirect(await roomObjectLink(key), 302);
    }
    const job = SLUG.test(req.nextUrl.searchParams.get("job") ?? "") ? `?job=${req.nextUrl.searchParams.get("job")}` : "";
    const [jobs, apps, quotes] = await Promise.all([accountApi("GET", "/v1/careers/jobs"), accountApi("GET", `/v1/careers/applications${job}`), accountApi("GET", "/v1/business/quotes")]);
    return json(200, { ...(jobs.body as object), ...(apps.body as object), ...(quotes.body as object) });
  }
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];

  // Group screening quote: anyone may ask, a few times an hour.
  if (p[0] === "quote") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (limited(`quote:${ip}`, 5, 3600_000)) return json(429, { error: "Too many requests. Try again later or email admin@e-cinema.net." });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await accountApi("POST", "/v1/business/quotes", {
      organisation: String(b.organisation ?? ""), email: String(b.email ?? ""), guests: Number(b.guests) || 0,
      country: String(b.country ?? ""), kind: String(b.kind ?? ""), note: String(b.note ?? ""),
    });
    if (r.status !== 201) return pass(r);
    const q = r.body as Quote;
    if (emailEnabled) await sendQuoteRequest(q.organisation, q.email, q.guests, q.country, q.kind, q.note).catch((e) => console.error("Quote email failed", e instanceof Error ? e.message : e));
    return json(200, { ok: true });
  }

  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });

  // CV upload: a real PDF up to 5 MB, stored privately.
  if (p[0] === "cv") {
    if (!mediaEnabled) return json(503, { error: "Uploads are paused right now" });
    if (limited(`cv:${s.slice(0, 16)}`, 6)) return json(429, { error: "Too many uploads. Wait a minute." });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return json(400, { error: "Choose a file" });
    if (file.size === 0 || file.size > 5 << 20) return json(400, { error: "Your CV must be a PDF up to 5 MB" });
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.subarray(0, 5).toString("latin1").startsWith("%PDF")) return json(400, { error: "Your CV must be a PDF" });
    // Refuse PDFs that run scripts or launch files; a CV has no need for them.
    const text = buf.toString("latin1");
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(text)) return json(400, { error: "This PDF has scripts or attachments in it. Save it again as a plain PDF." });
    const key = `careers/${randomUUID()}.pdf`;
    await putRoomObject(key, buf, "application/pdf");
    return json(200, { key, name: file.name.slice(0, 120) });
  }

  if (p[0] === "jobs" && SLUG.test(p[1] ?? "") && p[2] === "apply") {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const r = await accountApi("POST", `/v1/me/jobs/${p[1]}/apply`, {
      name: String(b.name ?? ""), email: String(b.email ?? ""), country: String(b.country ?? ""), link: String(b.link ?? ""),
      cvKey: String(b.cvKey ?? ""), why: String(b.why ?? ""), keep: Boolean(b.keep), ngEligible: Boolean(b.ngEligible),
    }, s);
    if (r.status !== 201) return pass(r);
    const a = r.body as Application;
    if (emailEnabled) await sendApplicationReceived(a.email, a.name, a.job.title).catch((e) => console.error("Application email failed", e instanceof Error ? e.message : e));
    return json(200, { application: { ...a, cvKey: undefined } });
  }

  if (p[0] === "applications" && UUID.test(p[1] ?? "") && p[2] === "withdraw") return pass(await accountApi("POST", `/v1/me/applications/${p[1]}/withdraw`, {}, s));

  if (p[0] === "desk") {
    if (!(await staff())) return json(403, { error: "Staff only" });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (p[1] === "applications" && UUID.test(p[2] ?? "")) {
      const r = await accountApi("POST", `/v1/careers/applications/${p[2]}`, {
        stage: b.stage ?? "", message: b.message ?? "", taskDue: b.taskDue || null, taskPay: b.taskPay ?? "",
        interviewAt: b.interviewAt || null, interviewWith: b.interviewWith ?? "",
      });
      if (r.status !== 200) return pass(r);
      const a = r.body as Application;
      const rows: [string, string][] = [];
      if (b.interviewAt && a.interviewAt) rows.push(["When", fmtDate(a.interviewAt)], ["With", a.interviewWith || "The hiring team"], ["Where", "Video call, link to follow"]);
      if (b.taskDue && a.taskDue) rows.push(["Due", new Date(a.taskDue).toLocaleDateString("en-GB", { day: "numeric", month: "short" })], ["Paid", a.taskPay || "Yes"]);
      if (emailEnabled && (b.stage || rows.length)) await sendApplicationUpdate(a.email, a.name, a.job.title, a.stage, String(b.message ?? ""), rows).catch((e) => console.error("Application update email failed", e instanceof Error ? e.message : e));
      return json(200, { application: a });
    }
    if (p[1] === "quotes" && UUID.test(p[2] ?? "")) return pass(await accountApi("POST", `/v1/business/quotes/${p[2]}`, { status: b.status }));
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  if (!(await staff())) return json(403, { error: "Staff only" });
  const b = await req.json().catch(() => ({}));
  if (p[0] === "desk" && p[1] === "jobs" && SLUG.test(p[2] ?? "")) return pass(await accountApi("PUT", `/v1/careers/jobs/${p[2]}`, b));
  if (p[0] === "desk" && p[1] === "share") return pass(await accountApi("PUT", "/v1/careers/share", { ngShare: Number((b as { ngShare?: number }).ngShare) }));
  return json(404, { error: "Not found" });
}
