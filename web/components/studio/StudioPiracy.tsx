"use client";
import { useState } from "react";
import { countryName } from "@/lib/worldmap";
import { scall } from "./scall";

// Figma "Studio / Piracy protection" (39:578). Every stream carries a viewer code burned into the
// picture. A studio reports a copy it found; we match the code to the ticket holder, Studio AI
// drafts the takedown notice, and E-Cinema staff close the account after checking.

type Leak = {
  id: string; showtimeId: string; film: string; kind: "clip" | "full" | "screenshot" | "other"; place: string; link: string; what: string;
  code: string; traced: boolean; country: string; status: "open" | "takedown_sent" | "taken_down" | "allowed"; ban: "" | "requested" | "banned" | "declined";
  notice: string; createdAt: string; sentAt: string | null; takenDownAt: string | null;
};
type Stats = { found30: number; foundPrev30: number; takenDown: number; toTakeDown: number; medianHours: number; banned: number; traced: number };
export type LeakData = { leaks: Leak[]; stats: Stats };

const PLACES: Record<string, string> = { website: "Website", telegram: "Telegram", tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Instagram", facebook: "Facebook", whatsapp: "WhatsApp", other: "Other" };
const KINDS: Record<string, string> = { clip: "Clip", full: "Full film", screenshot: "Screenshot or still", other: "Something else" };
const n = (v: number) => v.toLocaleString("en-US");
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" }).format(new Date(iso));

function hours(h: number) {
  if (h <= 0) return "";
  return h < 1 ? `median ${Math.max(1, Math.round(h * 60))} minutes` : h < 48 ? `median ${Math.round(h)} hours` : `median ${Math.round(h / 24)} days`;
}

function title(l: Leak) {
  const what = l.what ? `: ${l.what}` : "";
  const film = l.film ? ` of ${l.film}` : "";
  return { clip: `Clip${film}${what}`, full: `Full film${film}${what}`, screenshot: `Still${film}${what}`, other: `${l.film || "Material"}${what}` }[l.kind];
}

function state(l: Leak) {
  if (l.status === "allowed") return { text: "No action", tone: "grey" };
  const ban = l.ban === "banned" ? " · banned" : l.ban === "requested" ? " · ban asked" : "";
  if (l.status === "taken_down") return { text: `Taken down${ban}`, tone: "green" };
  if (l.status === "takedown_sent") return { text: `Notice sent${ban}`, tone: "amber" };
  return { text: `Studio decision${ban}`, tone: "amber" };
}

function Print({ tone }: { tone: string }) {
  return (
    <span className={`stpy-print ${tone}`} aria-hidden>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M6.5 18.5c1.2-1.9 1.8-4 1.8-6.5a3.7 3.7 0 0 1 7.4 0c0 1.2-.1 2.4-.3 3.5" /><path d="M4.3 15.5c.5-1.1.7-2.3.7-3.5a7 7 0 0 1 12.6-4.2" /><path d="M12 12c0 3.3-.9 6.3-2.6 8.8" /><path d="M14.9 18.8c-.3.8-.7 1.6-1.1 2.3" /><path d="M19 11.2c.1.3.1.5.1.8 0 1.5-.2 3-.5 4.4" />
      </svg>
    </span>
  );
}

export default function StudioPiracy({ initial, films, canEdit, failed }: { initial: LeakData; films: { id: string; title: string }[]; canEdit: boolean; failed: boolean }) {
  const [d, setD] = useState(initial);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [open, setOpen] = useState("");
  const [reporting, setReporting] = useState(false);
  const [form, setForm] = useState({ showtimeId: films[0]?.id ?? "", kind: "clip", place: "telegram", link: "", what: "", code: "" });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function reload() {
    setD(await scall<LeakData>("GET", "leaks"));
  }
  async function run(key: string, f: () => Promise<unknown>, done?: string) {
    setBusy(key); setErr(""); setMsg("");
    try { await f(); await reload(); if (done) setMsg(done); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  const report = () => run("report", async () => {
    const l = await scall<Leak>("POST", "leaks", form);
    setReporting(false); setOpen(l.id);
    setForm((f) => ({ ...f, link: "", what: "", code: "" }));
  }, "Leak saved.");
  const update = (l: Leak, body: Record<string, unknown>, done?: string) => run(l.id, () => scall("PUT", `leaks/${l.id}`, body), done);

  const s = d.stats;
  const diff = s.found30 - s.foundPrev30;
  const shown = d.leaks.filter((l) => filter === "all" || (filter === "open" ? l.status === "open" || l.status === "takedown_sent" : l.status === "taken_down" || l.status === "allowed"));

  return (
    <div className="pt-body stcr stpy">
      <header className="bp-head">
        <div>
          <h1>Piracy protection</h1>
          <p>Every stream carries a viewer code unique to the person watching. Report a copy you find and we trace it back.</p>
        </div>
      </header>
      {failed && <p className="vf-err" role="alert">Your leak reports could not be loaded just now. Refresh the page to try again.</p>}

      <div className="stcr-tiles stpy-tiles">
        <div className="stcr-tile">
          <small>Leaks found (30 days)</small>
          <b>{n(s.found30)}</b>
          <span className={diff > 0 ? "r" : "g"}>{s.foundPrev30 || s.found30 ? `${diff > 0 ? "▲" : diff < 0 ? "▼" : ""} ${Math.abs(diff)} vs last month`.trim() : "none reported"}</span>
        </div>
        <div className="stcr-tile">
          <small>Taken down</small>
          <b>{n(s.takenDown)} of {n(s.toTakeDown)}</b>
          <span className="g">{hours(s.medianHours) || "none yet"}</span>
        </div>
        <div className="stcr-tile">
          <small>Accounts banned</small>
          <b>{n(s.banned)}</b>
          <span className="g">signed out and blocked from signing in</span>
        </div>
        <div className="stcr-tile soon">
          <small>Capture attempts blocked <em className="soon-tag">Soon</em></small>
          <b>–</b>
          <span>Counted once the Android app blocks screen capture</span>
        </div>
      </div>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <section className="bp-panel" aria-label="Leaks found">
        <div className="stcr-ph">
          <h2>Leaks found</h2>
          <div className="bp-chips">
            {(["all", "open", "closed"] as const).map((f) => <button key={f} type="button" className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
            {canEdit && <button type="button" className="stpy-add" onClick={() => { setReporting(!reporting); setErr(""); }}>Report a leak</button>}
          </div>
        </div>

        {reporting && (
          <form className="stpy-form" onSubmit={(e) => { e.preventDefault(); report(); }}>
            <label className="vf-field"><span>Link to the copy</span><div className="vf-box"><input type="url" required value={form.link} maxLength={500} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://t.me/channel/123" /></div></label>
            <div className="stpy-grid">
              <label className="vf-field"><span>Film</span><div className="vf-box"><select value={form.showtimeId} onChange={(e) => setForm({ ...form, showtimeId: e.target.value })}>
                <option value="">Not sure</option>
                {films.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
              </select></div></label>
              <label className="vf-field"><span>What it is</span><div className="vf-box"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div></label>
              <label className="vf-field"><span>Where</span><div className="vf-box"><select value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })}>
                {Object.entries(PLACES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div></label>
              <label className="vf-field"><span>Viewer code in the picture</span><div className="vf-box"><input value={form.code} maxLength={8} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="AB-CDE23" autoCapitalize="characters" /></div></label>
            </div>
            <label className="vf-field"><span>Details (optional)</span><div className="vf-box"><input value={form.what} maxLength={200} onChange={(e) => setForm({ ...form, what: e.target.value })} placeholder="2 clips, 01:02:10 and 01:15:44" /></div></label>
            <p className="pt-hint">The code sits after &ldquo;E-CINEMA&rdquo; in a corner of the picture. With it we can tell which ticket holder streamed the copy; we never show you who they are.</p>
            <div className="pt-btns">
              <button type="button" className="vf-btn ghost sm" onClick={() => setReporting(false)}>Cancel</button>
              <button className="vf-btn red sm" disabled={busy === "report" || !form.link.trim()}>{busy === "report" ? "Saving" : "Save and trace"}</button>
            </div>
          </form>
        )}

        {shown.length ? (
          <ul className="stpy-list">
            {shown.map((l) => {
              const st = state(l);
              const isOpen = open === l.id;
              const draft = drafts[l.id] ?? l.notice;
              return (
                <li key={l.id} className={isOpen ? "on" : ""}>
                  <button type="button" className="stpy-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : l.id)}>
                    <Print tone={st.tone} />
                    <span className="what"><b>{title(l)}</b><small>{PLACES[l.place]} · {host(l.link)} · {day(l.createdAt)}</small></span>
                    <span className="to"><small>Traced to</small>{l.traced ? `Viewer ${l.code}${l.country ? ` · ${countryName(l.country)}` : ""}` : l.code ? `Code ${l.code} · no ticket holder` : "No code read"}</span>
                    <em className={st.tone}>{st.text}</em>
                  </button>
                  {isOpen && (
                    <div className="stpy-more">
                      <p className="stpy-link"><a href={l.link} target="_blank" rel="noopener noreferrer nofollow">{l.link}</a></p>
                      {canEdit && l.status !== "allowed" && (
                        <>
                          <label className="vf-field"><span>Takedown notice</span>
                            <div className="vf-box"><textarea rows={draft ? 10 : 3} value={draft} maxLength={6000} onChange={(e) => setDrafts({ ...drafts, [l.id]: e.target.value })} placeholder="Let Studio AI write it, or write your own" /></div>
                          </label>
                          <div className="pt-btns stpy-acts">
                            <button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => run(l.id, async () => { await scall("POST", `leaks/${l.id}/notice`); setDrafts((x) => { const y = { ...x }; delete y[l.id]; return y; }); }, "Notice written. Read it, then send it to the host or app.")}>
                              {busy === l.id ? "Working" : l.notice ? "Rewrite with Studio AI" : "Write notice with Studio AI"}
                            </button>
                            {drafts[l.id] !== undefined && drafts[l.id] !== l.notice && <button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => update(l, { notice: drafts[l.id] }, "Notice saved.")}>Save notice</button>}
                            {draft && <button type="button" className="vf-btn soft sm" onClick={() => navigator.clipboard.writeText(draft).then(() => setMsg("Notice copied."), () => setErr("Copy did not work; select the text instead."))}>Copy</button>}
                            {l.status === "open" && <button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => update(l, { status: "takedown_sent" }, "Marked as sent.")}>I sent it</button>}
                            {l.status !== "taken_down" && <button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => update(l, { status: "taken_down" }, "Marked as taken down.")}>It is gone</button>}
                            {l.status === "open" && <button type="button" className="vf-btn ghost sm" disabled={Boolean(busy)} onClick={() => update(l, { status: "allowed" }, "No action taken.")}>Allow it</button>}
                            {l.traced && l.ban === "" && <button type="button" className="vf-btn ghost danger sm" disabled={Boolean(busy)} onClick={() => update(l, { ban: true }, "Sent to E-Cinema. We check the copy against the code, then close the account.")}>Ask E-Cinema to ban</button>}
                          </div>
                          <p className="pt-hint">Automatic sending to hosts and apps is coming soon <em className="soon-tag">Soon</em></p>
                        </>
                      )}
                      {canEdit && l.status === "allowed" && <div className="pt-btns"><button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => update(l, { status: "open" }, "Reopened.")}>Reopen</button></div>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="pt-hint">{d.leaks.length ? "Nothing here." : "No leaks reported. When you find your film somewhere it should not be, report it here."}</p>
        )}
      </section>

      <div className="stpy-two">
        <section className="bp-panel" aria-label="Protection on your films">
          <h2>Protection on your films</h2>
          <ul className="stpy-guards">
            <li><span>Viewer code burned into every stream</span><i className="on" role="img" aria-label="On" /></li>
            <li><span>One account per person, face-verified, 2 devices</span><i className="on" role="img" aria-label="On" /></li>
            <li><span>Takedown notices written by Studio AI</span><i className="on" role="img" aria-label="On" /></li>
            <li><span>Multi-DRM (Widevine, PlayReady, FairPlay) <em className="soon-tag">Soon</em></span><i role="img" aria-label="Not yet" /></li>
            <li><span>Screen capture blocking on Android <em className="soon-tag">Soon</em></span><i role="img" aria-label="Not yet" /></li>
            <li><span>Seats sold only in the countries you allow (Settings, Default territories)</span><i className="on" role="img" aria-label="On" /></li>
          </ul>
        </section>
        <section className="bp-panel" aria-label="What we do when a leak is found">
          <h2>What we do when a leak is found</h2>
          <ol className="stpy-steps">
            <li><b>1</b>You report the link and the viewer code you can see in the picture</li>
            <li><b>2</b>We match the code to the ticket holder who streamed it</li>
            <li><b>3</b>Studio AI writes the takedown notice for the host, app or ISP</li>
            <li><b>4</b>After checking, E-Cinema closes that account on every device</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
