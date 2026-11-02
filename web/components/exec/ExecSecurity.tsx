"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Incident, SecurityData } from "@/lib/exec";
import { MAP_H, MAP_W, dots } from "@/lib/worldmap";

// Security operations (Figma 117:1773). Counts are what the platform itself refused; edge traffic
// (bots, DDoS) needs Cloudflare in front of the site, so those rows say Soon instead of a number.
const LAND = dots();
const KIND: Record<string, string> = { attack: "Attack", breach: "Breach", pentest: "Pen test", bounty: "Bug bounty round", outage: "Outage", other: "Other" };
const SEV: Record<string, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lagos = (iso: string) => new Date(Date.parse(iso) + 3600_000);
const hm = (iso: string) => { const d = lagos(iso); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
const dm = (iso: string) => { const d = lagos(iso); return `${d.getUTCDate()} ${M[d.getUTCMonth()]}`; };
const num = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString("en-US"));
const PILL: Record<string, [string, string]> = { blocked: ["Blocked", "ok"], allowed: ["Allowed", ""], done: ["Done", "ok"], open: ["Open", "bad"], closed: ["Closed", ""] };
const EMPTY = { title: "", kind: "attack", severity: "medium", note: "" };

export default function ExecSecurity({ d }: { d: SecurityData }) {
  const router = useRouter();
  const [lock, setLock] = useState(false);
  const [book, setBook] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { const t = setInterval(() => router.refresh(), 30_000); return () => clearInterval(t); }, [router]);

  const rows: [string, number | null][] = [
    ["Credential stuffing", d.wrongPw24h], ["Accounts locked", d.locked24h], ["Bot traffic", null], ["DDoS", null], ["Card testing", null], ["Screen capture tries", null], ["API abuse", null],
  ];
  const peak = Math.max(1, ...rows.map((r) => r[1] ?? 0));
  type Row = { at: string; title: string; detail: string; result: string; inc?: Incident };
  const feed: Row[] = [
    ...d.events,
    ...d.incidents.map((i) => ({ at: i.openedAt, title: `${KIND[i.kind] ?? i.kind}: ${i.title}`, detail: `${SEV[i.severity] ?? i.severity}${i.note ? ` · ${i.note}` : ""}`, result: i.status, inc: i })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 10);

  async function call(url: string, method: string, body: unknown) {
    setBusy(true); setErr("");
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "That did not work. Try again."); return false; }
    router.refresh();
    return true;
  }
  async function toggleLock() {
    if (await call("/api/executive/security/lockdown", "PUT", { on: !d.lockdown })) { setLock(false); setMsg(d.lockdown ? "Lock down ended. Sign-ups and new devices work again." : "Lock down is on. Nobody new can sign up or sign in from a new device."); }
  }
  async function logIncident(e: React.FormEvent) {
    e.preventDefault();
    if (await call("/api/executive/security/incidents", "POST", form)) { setForm(EMPTY); setBook(false); setMsg("Incident logged."); }
  }
  const defences: [string, string, string][] = [
    ["Web firewall and DDoS shield", "Render's edge absorbs floods. Cloudflare's firewall is not in front of the site yet", "part"],
    ["Bot defence", "Challenge on sign-up, checkout and chat", "soon"],
    ["Passkeys and face check", `${d.passkeys.toLocaleString("en-US")} account${d.passkeys === 1 ? "" : "s"} with a passkey · ${d.faceChecked.toLocaleString("en-US")} face checked with Sumsub`, "on"],
    ["Encryption", "HTTPS only, TLS 1.2 or newer, passwords hashed with Argon2id, data encrypted at rest", "on"],
    ["Secrets", "Kept in GitHub and Render secrets, never in code. Scheduled rotation is coming", "on"],
    ["Least privilege", "Roles for executives, studios and staff desks. A log of every admin action is coming", "on"],
    ["Watermarking", "A viewer code in every stream traces a leak to one account", "on"],
    ["Lock down mode", d.lockdown ? `On since ${hm(d.lockdownAt ?? "")}, ${dm(d.lockdownAt ?? "")}` : "Stops sign-ups and sign-ins from new devices in one click", d.lockdown ? "lock" : "off"],
  ];
  const ST: Record<string, [string, string]> = { on: ["On", "ok"], part: ["Partly", "warn"], soon: ["Soon", ""], off: ["Ready", ""], lock: ["On", "bad"] };

  return (
    <section className="exc exsec">
      <header className="exc-head">
        <div>
          <h1>Security operations</h1>
          <p className="exc-sub">What the platform blocks, in real time. CEO and CTO only.</p>
        </div>
        <div className="epf-acts">
          <span className="exsec-live" title="Refreshes every 30 seconds">Live</span>
          {d.canEdit && <button type="button" className={d.lockdown ? "exa-red" : "exa-ghost"} onClick={() => { setLock(true); setErr(""); }}>{d.lockdown ? "End lock down" : "Lock down mode"}</button>}
          {d.canEdit && <button type="button" className="exa-ghost exsec-pb" onClick={() => { setBook(true); setErr(""); }}>Incident playbook</button>}
        </div>
      </header>
      {d.lockdown && <p className="exsec-banner" role="status">Lock down is on{d.lockdownBy ? `, turned on by ${d.lockdownBy}` : ""}. People already signed in keep watching; nobody new can sign up or sign in from a new device. Executives still can.</p>}
      {msg && <p className="exa-msg" role="status">{msg}</p>}

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Sign-in attacks blocked today</span><b>{num(d.blockedToday)}</b><small className="up">wrong passwords refused</small></div>
        <div className="exc-tile"><span>Breaches</span><b>{d.breaches}</b><small className={d.breaches ? "down" : "up"}>logged, last 365 days</small></div>
        <div className="exc-tile"><span>Account takeovers stopped</span><b>{num(d.takeovers)}</b><small className="up">locked after 10 wrong passwords</small></div>
        <div className="exc-tile"><span>Open critical issues</span><b>{d.openCritical}</b><small className={d.openCritical ? "down" : "up"}>{d.lastPenTest ? `last pen test ${dm(d.lastPenTest)}` : "no pen test logged yet"}</small></div>
      </div>

      <div className="exc-row exsec-row">
        <div className="exc-card">
          <h2>Blocked by type, 24 hours</h2>
          {rows.map(([name, n]) => (
            <div key={name} className="exf-sig exh-bar exsec-bar"><span>{name}</span><i>{n !== null && <em style={{ width: `${(n / peak) * 100}%`, background: "#e3182d" }} />}</i><b>{n === null ? <small className="exsec-soon">Soon</small> : num(n)}</b></div>
          ))}
          <p className="epf-hint">Bot, DDoS, card testing, capture and API counts arrive once Cloudflare sits in front of the site.</p>
        </div>
        <div className="exc-card">
          <h2>Where attacks come from</h2>
          <div className="exsec-map">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="exc-world" role="img" aria-label="Attack map coming soon">
              {LAND.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="#34343f" />)}
            </svg>
            <span className="exsec-soon">Soon</span>
          </div>
          <p className="epf-hint">Needs the visitor country from Cloudflare&apos;s edge. We never guess it.</p>
        </div>
      </div>

      <div className="exc-row exsec-row2">
        <div className="exc-card">
          <h2>Defences</h2>
          {defences.map(([t, s, st]) => (
            <div key={t} className="exsec-def"><div><b>{t}</b><small>{s}</small></div><i className={`exsec-pill ${ST[st][1]}`}>{ST[st][0]}</i></div>
          ))}
        </div>
        <div className="exc-card">
          <h2>Recent events</h2>
          {feed.length === 0 && <p className="exc-empty">Nothing in the last 30 days.</p>}
          {feed.map((e, i) => (
            <div key={`${e.at}-${i}`} className="exsec-ev">
              <div><b>{hm(e.at)}{dm(e.at) !== dm(new Date().toISOString()) ? `, ${dm(e.at)}` : ""} · {e.title}</b><small>{e.detail}</small></div>
              <span className="exsec-evr">
                <i className={`exsec-pill ${PILL[e.result]?.[1] ?? ""}`}>{PILL[e.result]?.[0] ?? e.result}</i>
                {e.inc && d.canEdit && <button type="button" className="exsec-link" disabled={busy} onClick={() => call(`/api/executive/security/incidents/${e.inc!.id}`, "PUT", { closed: e.inc!.status === "open" })}>{e.inc.status === "open" ? "Close" : "Reopen"}</button>}
              </span>
            </div>
          ))}
          <p className="epf-hint">Locked accounts, piracy bans, takedowns and the incident log, last 30 days.</p>
        </div>
      </div>

      {lock && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-label="Lock down mode" onClick={(e) => e.target === e.currentTarget && setLock(false)}>
          <div className="exa-dialog">
            <h2>{d.lockdown ? "End lock down?" : "Turn on lock down?"}</h2>
            {d.lockdown ? <p className="exc-sub">Sign-ups and sign-ins from new devices start working again straight away.</p> : (
              <ul className="exsec-list">
                <li>Nobody can make a new account.</li>
                <li>Nobody can sign in from a device we have not seen on their account.</li>
                <li>People already signed in keep watching. Screenings keep running.</li>
                <li>Executives and the CEO can still sign in anywhere.</li>
              </ul>
            )}
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setLock(false)}>Cancel</button><button type="button" className="exa-red" disabled={busy} onClick={toggleLock}>{busy ? "Saving…" : d.lockdown ? "End lock down" : "Turn on lock down"}</button></div>
          </div>
        </div>
      )}
      {book && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-label="Incident playbook" onClick={(e) => e.target === e.currentTarget && setBook(false)}>
          <form className="exa-dialog" onSubmit={logIncident}>
            <h2>Incident playbook</h2>
            <ol className="exsec-list">
              <li><b>Contain.</b> If accounts are being taken over, turn on lock down mode. For a leak, report it on the studio piracy page so the viewer code is traced.</li>
              <li><b>Log it here</b> with a severity, so the CEO and CTO see the same picture.</li>
              <li><b>Rotate</b> any key that may have leaked in GitHub secrets, then redeploy.</li>
              <li><b>Tell people.</b> If personal data was exposed, tell the people affected and the NDPC within 72 hours.</li>
              <li><b>Close it</b> once fixed, with a note on what changed.</li>
            </ol>
            <h3 className="exsec-h3">Log an incident</h3>
            <label className="epf-f"><span>What happened</span><input required minLength={3} maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Wave of sign-in tries on studio accounts" /></label>
            <div className="epf-two">
              <label className="epf-f"><span>Kind</span><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label className="epf-f"><span>Severity</span><select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{Object.entries(SEV).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            </div>
            <label className="epf-f"><span>Note (optional)</span><textarea rows={3} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <p className="epf-hint">Pen tests and bug bounty rounds are saved as finished records.</p>
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setBook(false)}>Close</button><button type="submit" className="exa-red" disabled={busy}>{busy ? "Saving…" : "Log incident"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}
