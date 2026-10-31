import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { accountApi, SESSION_COOKIE } from "@/lib/auth";
import { emailEnabled, sendDeletionScheduled } from "@/lib/email";
import { timesLeaked } from "@/lib/pwned";

export const dynamic = "force-dynamic";

// The settings pages (Figma "Web / Settings" frames) talk to the Go API through here.
const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const sameSite = (req: NextRequest) => {
  const origin = req.headers.get("origin");
  return !origin || new URL(origin).host === req.headers.get("host");
};
type Ctx = { params: Promise<{ action: string[] }> };

async function session() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const action = (await params).action.join("/");
  if (action === "export") {
    const r = await accountApi("GET", "/v1/me/export", undefined, s);
    if (r.status !== 200) return json(r.status, r.body);
    return new NextResponse(JSON.stringify(r.body, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="e-cinema-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }
  if (action === "all") {
    const [settings, profile, upcoming] = await Promise.all([
      accountApi("GET", "/v1/me/settings", undefined, s),
      accountApi("GET", "/v1/me/profile", undefined, s),
      accountApi("GET", "/v1/me/upcoming", undefined, s),
    ]);
    if (settings.status !== 200) return json(settings.status, settings.body);
    return json(200, { settings: settings.body, profile: profile.body, upcoming: upcoming.body });
  }
  return json(404, { error: "not found" });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!sameSite(req)) return json(403, { error: "cross-site request" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  if ((await params).action.join("/") !== "settings") return json(404, { error: "not found" });
  const b = await req.json().catch(() => ({}));
  const r = await accountApi("PATCH", "/v1/me/settings", {
    name: typeof b.name === "string" ? b.name : undefined,
    username: typeof b.username === "string" ? b.username : undefined,
    twoStep: typeof b.twoStep === "boolean" ? b.twoStep : undefined,
    loginAlerts: typeof b.loginAlerts === "boolean" ? b.loginAlerts : undefined,
    prefs: b.prefs && typeof b.prefs === "object" ? b.prefs : undefined,
  }, s);
  return json(r.status, r.body);
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameSite(req)) return json(403, { error: "cross-site request" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const action = (await params).action.join("/");
  const b = await req.json().catch(() => ({}));
  switch (action) {
    case "password": {
      if (typeof b.password !== "string" || b.password.length < 12) return json(400, { error: "Your new password needs at least 12 characters" });
      if (b.password !== b.confirm) return json(400, { error: "The two passwords do not match" });
      if (((await timesLeaked(b.password)) ?? 0) > 0) return json(400, { error: "This password has shown up in a data leak on another site. Please choose a different one." });
      const r = await accountApi("POST", "/v1/me/password", { current: b.current ?? "", password: b.password }, s);
      return json(r.status, r.body);
    }
    case "signout-all": {
      const r = await accountApi("POST", "/v1/me/signout-all", {}, s);
      const res = json(r.status, r.body);
      if (r.status === 200) res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    case "delete": {
      const r = await accountApi("POST", "/v1/me/delete", { confirm: b.confirm }, s);
      if (r.status !== 200) return json(r.status, r.body);
      const out = r.body as { deleteAfter: string; email: string; ticketsLost: number };
      if (emailEnabled) {
        try { await sendDeletionScheduled(out.email, out.deleteAfter, out.ticketsLost); } catch {}
      }
      const res = json(200, { deleteAfter: out.deleteAfter });
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
  }
  return json(404, { error: "not found" });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!sameSite(req)) return json(403, { error: "cross-site request" });
  const s = await session();
  if (!s) return json(401, { error: "Sign in first" });
  const [kind, id] = (await params).action;
  if (kind === "identities" && (id === "google" || id === "apple")) {
    const r = await accountApi("DELETE", `/v1/me/identities/${id}`, undefined, s);
    return r.status === 204 ? json(200, { ok: true }) : json(r.status, r.body);
  }
  return json(404, { error: "not found" });
}
