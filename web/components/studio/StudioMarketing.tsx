"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { money, type Upload } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / Marketing" (39:779). Studio AI picks the strongest moments of a film from its
// dialogue, before a spoiler cutoff. Campaigns are tracked links to a screening: each visit is
// reach, and seats bought after arriving through the link count towards the campaign.

export type Clip = { idx: number; startMs: number; endMs: number; title: string; why: string; format: "9:16" | "1:1" | "16:9"; approved: boolean };
export type ClipSet = { cutoffMs: number; clips: Clip[] };
export type Campaign = {
  id: string; showtimeId: string; film: string; name: string; channel: string; code: string; costCents: number;
  clicks: number; orders: number; seats: number; grossCents: number; createdAt: string;
};
type Screening = { id: string; title: string; startsAt: string; state: "upcoming" | "live" | "ended" };

const CHANNELS: Record<string, string> = {
  clips: "Clips feed", tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube Shorts", x: "X", facebook: "Facebook",
  whatsapp: "WhatsApp", email: "Email", creator: "Creator collab", other: "Other",
};
const TONES = ["plum", "wine", "sea", "amber", "red"];
const n = (v: number) => (v >= 10000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : v.toLocaleString("en-US"));
const dur = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const stamp = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const hm = (ms: number) => { const m = Math.round(ms / 60000); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const CUTOFFS = [20, 30, 40, 50, 60, 70, 80, 90, 100, 120].map((m) => m * 60000);

function premiere(films: Screening[], now: number) {
  const next = films.filter((f) => f.state !== "ended" && Date.parse(f.startsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) {
    const live = films.find((f) => f.state === "live");
    return live ? `${live.title} · live now` : "";
  }
  const days = Math.floor((Date.parse(next.startsAt) - now) / 86_400_000);
  return `${next.title} · ${days < 1 ? "premieres within a day" : `${days} ${days === 1 ? "day" : "days"} to premiere`}`;
}

export default function StudioMarketing({ uploads, upload, clips: first, languages, films, campaigns: firstCampaigns, canEdit, failed }: {
  uploads: { id: string; title: string }[]; upload: Upload | null; clips: ClipSet; languages: number; films: Screening[];
  campaigns: Campaign[]; canEdit: boolean; failed: boolean;
}) {
  const router = useRouter();
  const [clips, setClips] = useState(first);
  const [picked, setPicked] = useState<number[]>(first.clips.filter((c) => c.approved).map((c) => c.idx));
  const [campaigns, setCampaigns] = useState(firstCampaigns);
  const [launching, setLaunching] = useState(false);
  const upcoming = films.filter((f) => f.state !== "ended");
  const [form, setForm] = useState({ name: "", channel: "tiktok", showtimeId: (upcoming[0] ?? films[0])?.id ?? "", cost: "" });
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [head, setHead] = useState("");
  const [origin, setOrigin] = useState("https://e-cinema.net");

  // Time-dependent text is worked out in the browser so server and browser render the same page.
  useEffect(() => {
    const t = setTimeout(() => { setHead(premiere(films, Date.now())); setOrigin(window.location.origin); }, 0);
    return () => clearTimeout(t);
  }, [films]);

  async function run(key: string, f: () => Promise<unknown>, done?: string) {
    setBusy(key); setErr(""); setMsg("");
    try { await f(); if (done) setMsg(done); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  const reloadCampaigns = async () => setCampaigns((await scall<{ campaigns: Campaign[] }>("GET", "campaigns")).campaigns);
  const generate = (cutoffMs = clips.cutoffMs) => run("gen", async () => {
    const c = await scall<ClipSet>("POST", `uploads/${upload!.id}/clips/generate`, { cutoffMs });
    setClips(c); setPicked([]);
  }, "Studio AI picked new moments. Tap the ones you like, then approve them.");
  const approve = () => run("approve", async () => {
    const c = await scall<ClipSet>("POST", `uploads/${upload!.id}/clips/approve`, { idx: picked });
    setClips(c);
  }, picked.length ? `${picked.length} ${picked.length === 1 ? "clip" : "clips"} approved.` : "Approvals cleared.");
  const setCutoff = (ms: number) => {
    if (ms === clips.cutoffMs) return;
    if (clips.clips.some((c) => c.endMs > ms)) { generate(ms); return; }
    run("cut", async () => setClips(await scall<ClipSet>("PUT", `uploads/${upload!.id}/clips`, { cutoffMs: ms, clips: clips.clips })), "Spoiler cutoff saved.");
  };
  const launch = () => run("launch", async () => {
    const c = await scall<Campaign>("POST", "campaigns", { name: form.name, channel: form.channel, showtimeId: form.showtimeId, costCents: Math.round((Number(form.cost) || 0) * 100) });
    await reloadCampaigns();
    setLaunching(false); setForm((f) => ({ ...f, name: "", cost: "" }));
    await navigator.clipboard?.writeText(`${window.location.origin}/c/${c.code}`).catch(() => {});
  }, "Campaign launched. Its link is copied: share it wherever the campaign runs.");
  const saveCost = (c: Campaign) => run(c.id, async () => {
    await scall("PUT", `campaigns/${c.id}`, { costCents: Math.round((Number(costs[c.id]) || 0) * 100) });
    setCosts((x) => { const y = { ...x }; delete y[c.id]; return y; });
    await reloadCampaigns();
  }, "Cost saved.");
  const remove = (c: Campaign) => run(c.id, async () => { await scall("DELETE", `campaigns/${c.id}`); await reloadCampaigns(); }, "Campaign removed. Seats it sold stay counted in your revenue.");
  const copy = (text: string, done: string) => navigator.clipboard.writeText(text).then(() => setMsg(done), () => setErr("Copy did not work; select the link instead."));

  const trailer = upload?.files.find((f) => f.kind === "trailer");
  const subs = upload?.files.find((f) => f.kind === "subtitles" && f.status === "uploaded");
  const share = upcoming[0] ?? films[0];
  const changed = picked.length !== clips.clips.filter((c) => c.approved).length || clips.clips.some((c) => c.approved !== picked.includes(c.idx));

  return (
    <div className="pt-body stcr stmk">
      <header className="bp-head">
        <div>
          <h1>Marketing</h1>
          <p>{head || "Clips, campaign links and press assets for your films."}</p>
        </div>
        {canEdit && films.length > 0 && <button type="button" className="vf-btn red" onClick={() => { setLaunching(!launching); setErr(""); }}>Launch campaign</button>}
      </header>
      {failed && <p className="vf-err" role="alert">Some of your marketing numbers could not be loaded just now. Refresh the page to try again.</p>}
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      {launching && (
        <form className="bp-panel stmk-form" onSubmit={(e) => { e.preventDefault(); launch(); }} aria-label="Launch campaign">
          <h2>Launch campaign</h2>
          <div className="stmk-grid">
            <label className="vf-field"><span>Name</span><div className="vf-box"><input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anime fans · Japan, Brazil" /></div></label>
            <label className="vf-field"><span>Channel</span><div className="vf-box"><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div></label>
            <label className="vf-field"><span>Screening</span><div className="vf-box"><select value={form.showtimeId} onChange={(e) => setForm({ ...form, showtimeId: e.target.value })}>
              {films.map((f) => <option key={f.id} value={f.id}>{f.title}{f.state === "ended" ? " (ended)" : ""}</option>)}
            </select></div></label>
            <label className="vf-field"><span>Cost in USD (optional)</span><div className="vf-box"><input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" /></div></label>
          </div>
          <p className="pt-hint">You get a short link for this campaign. Every visit through it counts as reach, and seats bought within a week of the visit count as seats from it.</p>
          <div className="pt-btns">
            <button type="button" className="vf-btn ghost sm" onClick={() => setLaunching(false)}>Cancel</button>
            <button className="vf-btn red sm" disabled={busy === "launch" || !form.name.trim() || !form.showtimeId}>{busy === "launch" ? "Launching" : "Launch and copy link"}</button>
          </div>
        </form>
      )}

      <section className="bp-panel stmk-clips" aria-label="AI clip generator">
        <div className="stcr-ph">
          <h2>AI clip generator</h2>
          <div className="stmk-tools">
            {uploads.length > 1 && (
              <select aria-label="Film" value={upload?.id} onChange={(e) => router.push(`/studio/marketing?film=${e.target.value}`)}>
                {uploads.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            )}
            <span className="stmk-ai">✦ Studio AI</span>
          </div>
        </div>
        {!upload ? (
          <p className="pt-hint">No films yet. <Link href="/studio/upload">Upload a film</Link> with its subtitle file and Studio AI picks the moments worth clipping.</p>
        ) : (
          <>
            <p className="stmk-lead">
              {clips.clips.length
                ? `Studio AI picked the ${clips.clips.length} strongest ${clips.clips.length === 1 ? "moment" : "moments"} of ${upload.title} without spoilers, each with the shape that suits it. Approve the ones you like.`
                : subs
                  ? `Studio AI reads the dialogue of ${upload.title} and picks the strongest moments before the spoiler cutoff.`
                  : `Upload the subtitle file of ${upload.title} first: Studio AI picks moments from the dialogue.`}
            </p>
            {clips.clips.length > 0 && (
              <ul className="stmk-cards">
                {clips.clips.map((c, i) => {
                  const on = picked.includes(c.idx);
                  return (
                    <li key={c.idx}>
                      <button type="button" className={`stmk-card ${TONES[i % TONES.length]}${on ? " on" : ""}`} aria-pressed={on} disabled={!canEdit}
                        title={c.why} onClick={() => setPicked(on ? picked.filter((x) => x !== c.idx) : [...picked, c.idx])}>
                        <span className="tc">{dur(c.endMs - c.startMs)} · {c.format}</span>
                        {c.approved && <span className="ok">Approved</span>}
                        <b>{c.title}</b>
                      </button>
                      <small>From {stamp(c.startMs)}</small>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="stmk-acts">
              {canEdit && clips.clips.length > 0 && (
                <button type="button" className="vf-btn red sm" disabled={Boolean(busy) || !changed} onClick={approve}>{busy === "approve" ? "Saving" : `Approve ${picked.length} selected`}</button>
              )}
              {canEdit && subs && (
                <button type="button" className="vf-btn soft sm" disabled={Boolean(busy)} onClick={() => generate()}>{busy === "gen" ? "Studio AI is watching" : clips.clips.length ? "Regenerate" : "Pick moments with Studio AI"}</button>
              )}
              <Link className="stmk-chip" href={`/studio/dubs?film=${upload.id}`}>Captions: {languages} {languages === 1 ? "language" : "languages"}</Link>
              {canEdit ? (
                <label className="stmk-chip">No spoilers after
                  <select value={clips.cutoffMs} disabled={Boolean(busy)} onChange={(e) => setCutoff(Number(e.target.value))} aria-label="Spoiler cutoff">
                    {(CUTOFFS.includes(clips.cutoffMs) ? CUTOFFS : [...CUTOFFS, clips.cutoffMs].sort((a, b) => a - b)).map((m) => <option key={m} value={m}>{hm(m)}</option>)}
                  </select>
                </label>
              ) : <span className="stmk-chip">No spoilers after {hm(clips.cutoffMs)}</span>}
            </div>
            <p className="pt-hint">Cutting the video clips and posting them to the Clips feed, TikTok, Instagram and YouTube Shorts is coming soon <em className="soon-tag">Soon</em></p>
          </>
        )}
      </section>

      <div className="stmk-two">
        <section className="bp-panel" aria-label="Campaigns">
          <h2>Campaigns</h2>
          {campaigns.length ? (
            <div className="stmk-table" role="table">
              <div className="stmk-tr th" role="row">
                <span role="columnheader">Campaign</span><span role="columnheader">Channel</span><span role="columnheader">Reach</span>
                <span role="columnheader">Seats from it</span><span role="columnheader">Cost</span>
              </div>
              {campaigns.map((c) => {
                const link = `${origin}/c/${c.code}`;
                const editing = costs[c.id] !== undefined;
                return (
                  <div key={c.id} className="stmk-tr" role="row">
                    <span role="cell" className="name"><b>{c.name}</b><small>{c.film} · /c/{c.code}</small><button type="button" className="stmk-link" onClick={() => copy(link, "Campaign link copied.")}>Copy link</button></span>
                    <span role="cell">{CHANNELS[c.channel] ?? c.channel}</span>
                    <span role="cell">{n(c.clicks)}</span>
                    <span role="cell">{n(c.seats)}{c.grossCents > 0 && <small>{money(c.grossCents, "USD", true)}</small>}</span>
                    <span role="cell" className="cost">
                      {editing ? (
                        <form onSubmit={(e) => { e.preventDefault(); saveCost(c); }}>
                          <input aria-label="Cost in USD" autoFocus inputMode="decimal" value={costs[c.id]} onChange={(e) => setCosts({ ...costs, [c.id]: e.target.value.replace(/[^0-9.]/g, "") })} />
                          <button className="stmk-link" disabled={busy === c.id}>Save</button>
                        </form>
                      ) : (
                        <>
                          {c.costCents ? money(c.costCents, "USD", true) : "Free"}
                          {canEdit && <span className="stmk-row-acts">
                            <button type="button" className="stmk-link" onClick={() => setCosts({ ...costs, [c.id]: c.costCents ? String(c.costCents / 100) : "" })}>Edit</button>
                            <button type="button" className="stmk-link danger" disabled={busy === c.id} onClick={() => { if (window.confirm(`Remove ${c.name}? Its link stops counting visits.`)) remove(c); }}>Remove</button>
                          </span>}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="pt-hint">No campaigns yet. {canEdit && films.length ? "Launch one to get a tracked link; reach and seats show here as people use it." : "Campaigns show here once your studio launches one."}</p>
          )}
        </section>

        <section className="bp-panel" aria-label="Assets">
          <h2>Assets</h2>
          <ul className="stmk-assets">
            <li>
              <Icon kind="film" />
              <span><b>{trailer ? `Trailer · ${trailer.name}` : "Trailer"}</b><small>{trailer ? (trailer.status === "uploaded" ? `${(trailer.size / 1048576).toFixed(0)} MB · uploaded` : "still uploading") : upload ? "Not uploaded yet" : "Upload a film first"}</small></span>
              {upload && !trailer && <Link className="stmk-link" href="/studio/upload">Upload</Link>}
            </li>
            <li>
              <Icon kind="film" />
              <span><b>Key art</b><small>{upload?.posterKey ? "Poster uploaded" : "No poster yet"}</small></span>
              {upload?.posterKey && <a className="stmk-link" href={`/api/studio/uploads/${upload.id}/poster`} target="_blank" rel="noopener noreferrer">Open</a>}
            </li>
            <li>
              <Icon kind="film" />
              <span><b>Press kit</b><small>{upload ? "PDF · key art, synopsis, cast and crew, premiere" : "Upload a film first"}</small></span>
              {upload && <a className="stmk-link" href={`/api/studio/uploads/${upload.id}/press-kit`} download>Download</a>}
            </li>
            <li>
              <Icon kind="link" />
              <span><b>Share link</b><small>{share ? `${origin.replace(/^https?:\/\//, "")}/film/${share.id}` : "Once a screening is scheduled"}</small></span>
              {share && <button type="button" className="stmk-link" onClick={() => copy(`${origin}/film/${share.id}`, "Share link copied.")}>Copy</button>}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Icon({ kind }: { kind: "film" | "link" }) {
  return (
    <i className="stmk-ic" aria-hidden>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {kind === "film"
          ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>
          : <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>}
      </svg>
    </i>
  );
}
