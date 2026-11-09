"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Campaign, CampaignsData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Notifications and re-engagement (Figma 51:375). Announcements reach members in the app and by
// email (members who keep "New features and updates" email on), in their app language when
// Claude translates them. Push, SMS, WhatsApp and AI best time are not connected yet.
const AUDIENCE: Record<string, string> = { everyone: "Everyone", lapsed: "Lapsed 30+ days", country: "One country" };
const CHANNEL: Record<string, string> = { inapp: "In-app", email: "Email" };
const AUTO: Record<string, string> = { premiere: "Your premiere starts in 1 hour", party: "Your friend opened a room", friend: "Friend requests", lottery: "You won seats in the lottery", gift: "A gift is waiting" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "–");
const num = (n: number) => n.toLocaleString("en-US");
// Lagos time on the server and in the browser alike, so the page renders the same in both.
const when = (iso: string) => `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT`;

export default function ExecNotifications({ d, email, ai }: { d: CampaignsData; email: boolean; ai: boolean }) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState({ title: "", body: "", link: "", audience: "everyone", country: d.countryList[0] ?? "NG", inapp: true, email: email, translate: ai, sendAt: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const others = d.languages.filter((l) => l.lang !== "en");
  const channels = [...(f.inapp ? ["inapp"] : []), ...(f.email ? ["email"] : [])];

  async function create(test: boolean) {
    if (f.title.trim().length < 3) { setMsg({ ok: false, text: "Give it a title of at least 3 characters." }); titleRef.current?.focus(); return; }
    setBusy(test ? "test" : "send"); setMsg(null);
    // A test needs the campaign held back: without a time it goes out in an hour.
    const at = f.sendAt ? new Date(f.sendAt).toISOString() : test ? new Date(Date.now() + 3600_000).toISOString() : "";
    const r = await fetch("/api/executive/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, channels, sendAt: at }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as Partial<Campaign> & { error?: string };
    if (!r?.ok || !b.id) { setBusy(""); setMsg({ ok: false, text: b.error ?? "Could not save it" }); return; }
    let text = at ? `Scheduled for ${when(at)}` : "Sent";
    if (b.langs) text += ` in English and ${b.langs} more language${b.langs === 1 ? "" : "s"}`;
    if (test) {
      const t = await fetch(`/api/executive/campaigns/${b.id}/test`, { method: "POST" }).catch(() => null);
      const tb = (await t?.json().catch(() => ({}))) as { members?: number; emailed?: number; error?: string };
      text = !t?.ok ? tb.error ?? "Saved, but the test did not go out"
        : tb.members ? `Test sent to ${tb.members} member${tb.members === 1 ? "" : "s"}${tb.emailed ? ` (${tb.emailed} by email)` : ""}. The rest get it ${when(at)}.`
        : `Nobody is in this audience yet, so the test reached no one. It is scheduled for ${when(at)}.`;
    }
    setBusy(""); setMsg({ ok: true, text });
    setF({ ...f, title: "", body: "", link: "", sendAt: "" });
    router.refresh();
  }

  async function act(c: Campaign, action: "test" | "cancel") {
    setBusy(`${action}${c.id}`); setMsg(null);
    const r = await fetch(`/api/executive/campaigns/${c.id}/${action}`, { method: "POST" }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { members?: number; emailed?: number; error?: string };
    setBusy("");
    setMsg(r?.ok ? { ok: true, text: action === "cancel" ? `"${c.title}" will not go out.` : b.members ? `Test sent to ${b.members} member${b.members === 1 ? "" : "s"}.` : "Nobody new in this audience to test with." } : { ok: false, text: b.error ?? "That did not work" });
    router.refresh();
  }

  return (
    <section className="exc exnt">
      <header className="exc-head">
        <div>
          <h1>Notifications and re-engagement</h1>
          <p className="exc-sub">Everyone hears about new features, premieres and coming-soon films, in the app and by email, in their own language.</p>
        </div>
        <button type="button" className="exa-red" onClick={() => { titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); titleRef.current?.focus(); }}>New announcement</button>
      </header>

      <div className="exc-tiles exrc-tiles">
        <div className="exc-tile"><span>Sent today</span><b>{num(d.sentToday)}</b><small className="up">in-app and email</small></div>
        <div className="exc-tile"><span>Open rate</span><b>{pct(d.opened30, d.sent30)}</b><small className="up">in the app, last 30 days</small></div>
        <div className="exc-tile"><span>Booked within 24 h</span><b>{pct(d.booked30, d.sent30)}</b><small className="up">of members who got one</small></div>
        <div className="exc-tile"><span>News email off</span><b>{pct(d.emailOff, d.members)}</b><small>{num(d.emailOff)} of {num(d.members)} members</small></div>
      </div>

      {msg && <p className={msg.ok ? "exnt-ok" : "epf-err"} role="status">{msg.text}</p>}

      <div className="exc-card">
        <h2>Campaigns</h2>
        <div className="exrc-table exnt-table" role="table">
          <div className="exrc-tr exrc-th" role="row"><span role="columnheader">Campaign</span><span role="columnheader">Audience</span><span role="columnheader">Channels</span><span role="columnheader">Sent</span><span role="columnheader">Opened</span><span role="columnheader">Came back</span><span role="columnheader">Status</span></div>
          {d.campaigns.length === 0 && d.automatic.length === 0 && <p className="exc-empty">Nothing sent yet. Write your first announcement below.</p>}
          {d.campaigns.map((c) => {
            const sent = c.sent + c.testSent;
            return (
              <div key={c.id} className="exrc-tr" role="row">
                <span role="cell" className="exnt-name"><b>{c.title}</b>{c.langs > 0 && <small>English + {c.langs} languages</small>}</span>
                <span role="cell">{c.audience === "country" ? countryName(c.country) : AUDIENCE[c.audience]}</span>
                <span role="cell">{c.channels.map((x) => CHANNEL[x] ?? x).join(", ")}</span>
                <span role="cell">{sent ? num(sent + c.emailed) : "–"}</span>
                <span role="cell">{c.channels.includes("inapp") && sent ? pct(c.opened, sent) : "–"}</span>
                <span role="cell" className="exrc-ok">{sent ? num(c.booked) : "–"}</span>
                <span role="cell" className="exnt-st">
                  {c.status === "scheduled" ? (
                    <>
                      <em className="exnt-pill sch">SCHEDULED</em><small>{when(c.sendAt)}</small>
                      <span className="exnt-acts">
                        <button type="button" className="exa-ghost" disabled={Boolean(busy)} onClick={() => act(c, "test")}>{busy === `test${c.id}` ? "…" : "1% test"}</button>
                        <button type="button" className="exa-ghost" disabled={Boolean(busy)} onClick={() => act(c, "cancel")}>Cancel</button>
                      </span>
                    </>
                  ) : c.status === "sending" ? <em className="exnt-pill live"><i />SENDING</em> : c.status === "cancelled" ? <em className="exnt-pill">CANCELLED</em> : <em className="exnt-pill">DONE</em>}
                </span>
              </div>
            );
          })}
          {d.automatic.map((a) => (
            <div key={a.kind} className="exrc-tr" role="row">
              <span role="cell" className="exnt-name"><b>{AUTO[a.kind] ?? a.kind}</b><small>Automatic</small></span>
              <span role="cell">{a.kind === "premiere" ? "Ticket holders" : a.kind === "party" || a.kind === "friend" ? "Friends" : "Members it concerns"}</span>
              <span role="cell">In-app</span>
              <span role="cell">{num(a.sent)}</span>
              <span role="cell">{pct(a.opened, a.sent)}</span>
              <span role="cell">–</span>
              <span role="cell" className="exnt-st"><em className="exnt-pill live"><i />ALWAYS ON</em></span>
            </div>
          ))}
        </div>
      </div>

      <div className="exc-row exnt-row">
        <form className="exc-card" onSubmit={(e) => { e.preventDefault(); void create(false); }}>
          <h2>Compose</h2>
          <div className="epf-two">
            <label className="epf-f"><span>Title</span><input ref={titleRef} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="VR premieres are here" /></label>
            <label className="epf-f"><span>Audience</span>
              <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                <option value="everyone">Everyone · {num(d.members)} members{f.translate && others.length ? " · auto-translated" : ""}</option>
                <option value="lapsed">Lapsed: no seat bought in 30+ days</option>
                <option value="country">Members in one country</option>
              </select>
            </label>
          </div>
          {f.audience === "country" && (
            <label className="epf-f"><span>Country</span><select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })}>{(d.countryList.length ? d.countryList : ["NG"]).map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select></label>
          )}
          <label className="epf-f"><span>Message</span><textarea rows={2} maxLength={300} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Put on your headset and sit in the front row of tonight's premiere." /></label>
          <div className="epf-two">
            <label className="epf-f"><span>Opens this page (optional)</span><input maxLength={200} value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="/coming-soon" /></label>
            <label className="epf-f"><span>Send at (empty sends now)</span><input type="datetime-local" value={f.sendAt} onChange={(e) => setF({ ...f, sendAt: e.target.value })} /></label>
          </div>
          <div className="exprt-chips exnt-chips">
            <button type="button" className="exprt-chip" disabled title="Push notifications are not connected yet">Push <small className="exsec-soon">Soon</small></button>
            <button type="button" className={`exprt-chip ${f.inapp ? "on" : ""}`} aria-pressed={f.inapp} onClick={() => setF({ ...f, inapp: !f.inapp })}>In-app</button>
            <button type="button" className={`exprt-chip ${f.email ? "on" : ""}`} aria-pressed={f.email} disabled={!email} onClick={() => setF({ ...f, email: !f.email })}>Email{!email && " · off here"}</button>
            <button type="button" className="exprt-chip" disabled>SMS <small className="exsec-soon">Soon</small></button>
            <button type="button" className="exprt-chip" disabled>WhatsApp <small className="exsec-soon">Soon</small></button>
            <button type="button" className="exprt-chip" disabled>AI best time <small className="exsec-soon">Soon</small></button>
          </div>
          <div className="exprt-chips exnt-chips">
            <button type="button" className={`exprt-chip ${f.translate && others.length ? "on" : ""}`} aria-pressed={f.translate && others.length > 0} disabled={!ai || others.length === 0} onClick={() => setF({ ...f, translate: !f.translate })}>
              {others.length ? `Translate to ${others.length} more language${others.length === 1 ? "" : "s"}` : "Translate (all members use English)"}
            </button>
          </div>
          <div className="epf-acts">
            <button type="button" className="exa-ghost exnt-grey" disabled={Boolean(busy) || channels.length === 0} onClick={() => void create(true)}>{busy === "test" ? "Sending test…" : "Send to 1% test"}</button>
            <button type="submit" className="exa-red" disabled={Boolean(busy) || channels.length === 0}>{busy === "send" ? (f.translate && others.length ? "Translating…" : "Sending…") : f.sendAt ? "Schedule" : "Send now"}</button>
          </div>
        </form>
        <div className="exc-card">
          <h2>Preview</h2>
          <div className="exnt-prev">
            <div className="exnt-note"><i>E</i><span><b>{f.title || "VR premieres are here"}</b><small>{f.body || "Put on your headset and sit in the front row of tonight's premiere."}</small></span></div>
            <p>{f.translate && others.length ? `Members whose app is in ${others.slice(0, 3).map((l) => l.lang.toUpperCase()).join(", ")}${others.length > 3 ? " and others" : ""} get Claude's translation` : "Shown as written"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
