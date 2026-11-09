"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { filmCode, type PremierePlan, type Upload, type UploadFile } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / Film detail" (99:247): what viewers will read, whether the files are ready,
// the poster and trailer, pre-sales and the actions that cannot be undone.
type Pill = { tone: "teal" | "amber" | "grey" | "red"; text: string };
type Row = { title: string; detail: string; pill: Pill };

const RUNTIME = /(\d+h \d+m|\d+m \d+s)$/;

function statusRows(u: Upload, rightsDeclared: boolean): Row[] {
  const of = (k: UploadFile["kind"]) => u.files.filter((f) => f.kind === k);
  const warns = (fs: UploadFile[]) => fs.reduce((a, f) => a + f.checks.filter((c) => c.state === "warn" && !c.text.startsWith("Age rating")).length + (f.status === "failed" ? 1 : 0), 0);
  const master = of("master")[0];
  const stems = of("stems"), subs = of("subtitles");
  const rows: Row[] = [];
  rows.push(!master ? { title: "Picture master", detail: "Not uploaded yet", pill: { tone: "grey", text: "Missing" } }
    : master.status === "uploading" ? { title: "Picture master", detail: "Still uploading", pill: { tone: "grey", text: "Uploading" } }
    : { title: "Picture master", detail: master.info.split(" · ").slice(1).join(" · ") || master.name, pill: warns([master]) ? { tone: "amber", text: `Fix ${warns([master])}` } : { tone: "teal", text: "Passed" } });
  const sound = stems.filter((f) => f.status === "uploaded");
  rows.push(sound.length ? { title: "Sound", detail: sound.map((f) => f.info.split(" · ").slice(1, 3).join(" · ")).join(", "), pill: warns(sound) ? { tone: "amber", text: `Fix ${warns(sound)}` } : { tone: "teal", text: "Passed" } }
    : { title: "Sound", detail: master ? "Sound from the master only. Add stems so dubs keep your music" : "Upload stems or a master with sound", pill: { tone: "grey", text: master ? "Master only" : "Missing" } });
  const done = subs.filter((f) => f.status === "uploaded");
  rows.push(done.length ? { title: "Subtitles", detail: done.map((f) => { const [lang, lines] = f.info.split(" · "); return lang === "Subtitles" ? `${lines ?? f.name}` : `${lang.replace(/ subtitles$/, "")} · ${lines}`; }).join(", "), pill: warns(subs) ? { tone: "amber", text: `Fix ${warns(subs)}` } : { tone: "teal", text: "Passed" } }
    : { title: "Subtitles", detail: "None yet. AI can write them from the dialogue", pill: { tone: "grey", text: "Missing" } });
  rows.push({ title: "Rights papers", detail: rightsDeclared ? "Declared when your studio was verified" : "Not declared", pill: rightsDeclared ? { tone: "teal", text: "Approved" } : { tone: "red", text: "Needed" } });
  rows.push({ title: "Watermark", detail: "Per-viewer code in the picture of every room, traced in Piracy protection", pill: { tone: "teal", text: "On" } });
  return rows;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: cents >= 1e8 ? "compact" : "standard", maximumFractionDigits: cents >= 1e8 ? 1 : 0 }).format(cents / 100);
const longAt = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).format(new Date(iso));
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
// A datetime-local value in the member's own zone.
const localInput = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };

export type FilmTab = "details" | "languages" | "rights" | "pre-sales";

export default function StudioFilmDetail({ tab = "details", children, upload: u0, plan: p0, canEdit, isOwner, rightsDeclared }: { tab?: FilmTab; children?: React.ReactNode; upload: Upload; plan: PremierePlan | null; canEdit: boolean; isOwner: boolean; rightsDeclared: boolean }) {
  const [plan, setPlan] = useState(p0);
  const [moving, setMoving] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [dlgErr, setDlgErr] = useState("");
  const [now] = useState(() => Date.now());
  // Dates read in the member's own zone, so they are written only in the browser.
  const client = useSyncExternalStore(() => () => {}, () => true, () => false);
  const longWhen = (iso: string) => (client ? longAt(iso) : "");
  const router = useRouter();
  const [u, setU] = useState(u0);
  const [d, setD] = useState({ title: u0.title, logline: u0.logline, genres: u0.genres, ageRating: u0.ageRating, castCrew: u0.castCrew, languages: u0.languages });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [posterAt, setPosterAt] = useState(0);
  const pick = useRef<HTMLInputElement>(null);
  const changed = (Object.keys(d) as (keyof typeof d)[]).some((k) => d[k] !== u[k]);
  const master = u.files.find((f) => f.kind === "master" && f.status === "uploaded");
  const trailer = u.files.find((f) => f.kind === "trailer" && f.status === "uploaded");
  const runtime = master ? RUNTIME.exec(master.info)?.[1] : "";
  const suggestion = u.files.flatMap((f) => f.checks).find((c) => c.text.startsWith("Age rating suggestion"))?.text.replace(/^Age rating suggestion: /, "").replace(/\. You confirm it in Details$/, "");
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await scall<{ upload: Upload }>("PUT", `uploads/${u.id}/details`, d);
      setU(r.upload);
      setMsg("Changes saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function poster(f: File) {
    setErr(""); setMsg("");
    const form = new FormData();
    form.set("file", f);
    try {
      const r = await fetch(`/api/studio/uploads/${u.id}/poster`, { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed");
      setU(j.upload); setPosterAt(Date.now()); setMsg("Poster saved.");
    } catch (e) { setErr((e as Error).message); }
  }
  async function remove() {
    if (!window.confirm(`Delete the draft "${u.title}" and every file uploaded for it? This cannot be undone.`)) return;
    try {
      await scall("DELETE", `uploads/${u.id}`);
      router.push("/studio/upload");
    } catch (e) { setErr((e as Error).message); }
  }

  async function move() {
    if (!moving) return;
    setBusy(true); setDlgErr("");
    try {
      const r = await scall<{ plan: PremierePlan }>("POST", `uploads/${u.id}/reschedule`, { StartsAt: new Date(moving).toISOString() });
      setPlan(r.plan); setMoving(null);
      setMsg(`Moved to ${longWhen(r.plan.startsAt)}. ${r.plan.holders ? `${r.plan.holders.toLocaleString("en-GB")} ticket ${r.plan.holders === 1 ? "holder is" : "holders are"} being emailed.` : ""}`.trim());
    } catch (e) { setDlgErr((e as Error).message); } finally { setBusy(false); }
  }
  async function withdraw() {
    setBusy(true); setDlgErr("");
    try {
      const r = await scall<{ plan: PremierePlan }>("POST", `uploads/${u.id}/withdraw`, {});
      setPlan(r.plan); setWithdrawing(null);
      setMsg(r.plan.refundsDue ? `Withdrawn. ${r.plan.refundsDue.toLocaleString("en-GB")} ${r.plan.refundsDue === 1 ? "ticket is" : "tickets are"} being refunded.` : "Withdrawn. No tickets were sold, so there is nothing to refund.");
    } catch (e) { setDlgErr((e as Error).message); } finally { setBusy(false); }
  }

  const live = plan && !plan.withdrawnAt;
  const started = live && Date.parse(plan.startsAt) <= now;
  const when = !plan ? "no premiere booked yet" : plan.withdrawnAt ? "premiere withdrawn" : started ? `premiered ${shortDay(plan.startsAt)}` : `premieres ${shortDay(plan.startsAt)}`;
  const rows = statusRows(u, rightsDeclared);
  const tabLink = (t: FilmTab, label: string) => t === tab
    ? <span className="on" aria-current="page">{label}</span>
    : <Link href={t === "details" ? `/studio/films/${u.id}` : `/studio/films/${u.id}?tab=${t}`} scroll={false}>{label}</Link>;
  return (
    <div className="pt-body stfd">
      <header className="bp-head">
        <div>
          <h1>{u.title}</h1>
          <p>{[filmCode(u.title, u.id), u.genres.split(",")[0]?.trim(), runtime, u.languages, when].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="pt-btns">
          {live && !started
            ? <Link className="vf-btn ghost" href={`/film/${plan.showtimeId}`} target="_blank" rel="noopener">Preview as viewer</Link>
            : <span className="vf-btn ghost stu-off" aria-disabled="true" title={!plan ? "Viewers see the film page once the premiere is booked" : "This premiere is no longer on sale"}>Preview as viewer</span>}
          {tab === "details" && canEdit && <button className="vf-btn red" form="stfd-form" disabled={busy || !changed || !d.title.trim()}>{busy ? "Saving" : "Save changes"}</button>}
        </div>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <nav className="bp-chips" aria-label="Film sections">
        {tabLink("details", "Details")}
        <Link href={`/studio/upload/${u.id}`}>Media</Link>
        {tabLink("languages", "Languages")}
        <Link href={`/studio/premieres?film=${u.id}`}>Pricing</Link>
        {tabLink("rights", "Rights")}
        {tabLink("pre-sales", "Pre-sales")}
      </nav>

      {tab !== "details" ? children : <div className="stfd-two">
        <div className="stfd-col">
          <section className="bp-panel">
            <h2>Details</h2>
            <form id="stfd-form" className="stfd-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="vf-field"><span>Title</span><div className="vf-box"><input value={d.title} onChange={set("title")} maxLength={120} required disabled={!canEdit} /></div></label>
              <label className="vf-field"><span>Logline</span><div className="vf-box"><input value={d.logline} onChange={set("logline")} maxLength={300} placeholder="One sentence that makes someone want a seat" disabled={!canEdit} /></div></label>
              <div className="stfd-pair">
                <label className="vf-field"><span>Genre</span><div className="vf-box"><input value={d.genres} onChange={set("genres")} maxLength={80} placeholder="Drama, thriller" disabled={!canEdit} /></div></label>
                <label className="vf-field"><span>Age rating</span><div className="vf-box"><input value={d.ageRating} onChange={set("ageRating")} maxLength={60} placeholder={suggestion ? suggestion.split(" (")[0] : "15 (NFVCB certificate no.)"} disabled={!canEdit} /></div></label>
              </div>
              {suggestion && !d.ageRating && <p className="pt-hint">AI suggests {suggestion} from your subtitles. The rating that counts in Nigeria is the one on your NFVCB certificate (G, PG, 12, 12A, 15, 18).</p>}
              <label className="vf-field"><span>Languages</span><div className="vf-box"><input value={d.languages} onChange={set("languages")} maxLength={80} placeholder="Yorùbá and English" disabled={!canEdit} /></div></label>
              <label className="vf-field"><span>Cast and crew</span><div className="vf-box"><input value={d.castCrew} onChange={set("castCrew")} maxLength={400} placeholder="Cast names · directed by …" disabled={!canEdit} /></div></label>
            </form>
          </section>
          <section className="bp-panel">
            <h2>Status checks</h2>
            {rows.map((r) => (
              <div key={r.title} className="stfd-v">
                <div><b>{r.title}</b><small>{r.detail}</small></div>
                <span className={`stfd-pill ${r.pill.tone}`}>{r.pill.text}</span>
              </div>
            ))}
          </section>
        </div>

        <div className="stfd-col">
          <section className="bp-panel">
            <h2>Poster and trailer</h2>
            <div className="stfd-art">
              <button type="button" className="stfd-poster" onClick={() => canEdit && pick.current?.click()} disabled={!canEdit}>
                {u.posterKey
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/studio/uploads/${u.id}/poster?v=${posterAt || u.updatedAt}`} alt={`${u.title} poster`} />
                  : <small>{canEdit ? "Add a poster" : "No poster yet"}</small>}
                <b>{u.title.toUpperCase()}</b>
              </button>
              <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void poster(f); e.target.value = ""; }} />
              <Link className="stfd-tr" href={`/studio/upload/${u.id}`}>
                <b>{trailer ? `Trailer · ${RUNTIME.exec(trailer.info)?.[1] ?? "uploaded"}` : "No trailer yet"}</b>
                <small>{trailer ? "Replace video" : "Upload a trailer"}</small>
              </Link>
            </div>
          </section>
          <section className="bp-panel">
            <h2>Pre-sales so far</h2>
            <div className="stfd-k">
              <div className="bp-kpi"><span>Seats sold</span><b>{(plan?.seats ?? 0).toLocaleString("en-GB")}</b>
                {!plan ? <em className="muted">on sale once the premiere is booked</em>
                  : plan.withdrawnAt ? <em className="neg">{plan.refundsDue ? `${plan.refundsDue.toLocaleString("en-GB")} ${plan.refundsDue === 1 ? "refund" : "refunds"} going out` : "all refunded"}</em>
                  : plan.week ? <em>+{plan.week.toLocaleString("en-GB")} this week</em> : <em className="muted">none in the last 7 days</em>}</div>
              <div className="bp-kpi"><span>Gross</span><b>{plan ? usd(plan.grossCents) : "–"}</b><em className="muted">{plan?.sharePct ?? 70}% to you</em></div>
            </div>
          </section>
          <section className="bp-panel">
            <h2>Danger zone</h2>
            <div className="stfd-v">
              <div><b>Move the premiere</b><small>{!plan ? "No premiere booked yet. Ticket holders get a free change or a refund" : plan.withdrawnAt ? "Withdrawn, so it cannot be moved" : started ? "It has already started" : `${client ? `Now ${longAt(plan.startsAt)}. ` : ""}Ticket holders get a free change or a refund`}</small></div>
              <button className="vf-btn sm sec" disabled={!canEdit || !live || Boolean(started)} onClick={() => { setDlgErr(""); setMoving(localInput(new Date(Math.max(Date.parse(plan!.startsAt), Date.now() + 86_400_000 + 3_600_000)).toISOString())); }}>Reschedule</button>
            </div>
            {plan && (
              <div className="stfd-v">
                <div><b>Withdraw the film</b><small>{plan.withdrawnAt ? `Withdrawn ${shortDay(plan.withdrawnAt)}. Every ticket is refunded automatically` : started ? "It has already started" : isOwner ? "Refunds every ticket automatically" : "Refunds every ticket automatically. Only the studio owner can do this"}</small></div>
                <button className="vf-btn sm ghost" disabled={!isOwner || !live || Boolean(started)} onClick={() => { setDlgErr(""); setWithdrawing(""); }}>Withdraw</button>
              </div>
            )}
            {canEdit && !plan && (
              <div className="stfd-v">
                <div><b>Delete this draft</b><small>It has not premiered, so no one holds a ticket. Every uploaded file is deleted</small></div>
                <button className="vf-btn sm ghost" onClick={remove}>Delete</button>
              </div>
            )}
          </section>
        </div>
      </div>}

      {moving !== null && plan && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-labelledby="stfd-mv" onClick={(e) => e.target === e.currentTarget && !busy && setMoving(null)}>
          <form className="stfd-dlg" onSubmit={(e) => { e.preventDefault(); void move(); }}>
            <h2 id="stfd-mv">Move the premiere of {u.title}</h2>
            <p>Now {longWhen(plan.startsAt)}. {plan.seats.toLocaleString("en-GB")} {plan.seats === 1 ? "seat" : "seats"} sold to {plan.holders.toLocaleString("en-GB")} ticket {plan.holders === 1 ? "holder" : "holders"}.</p>
            <label className="vf-field"><span>New date and time (your zone)</span><div className="vf-box"><input type="datetime-local" value={moving} min={localInput(new Date(now + 86_400_000).toISOString())} onChange={(e) => setMoving(e.target.value)} required /></div></label>
            <div className="stfd-note"><b>What ticket holders get</b><span>Every seat moves to the new time. Each holder gets an email and can take a full refund for 7 days. Pick a time at least 24 hours away.</span></div>
            {dlgErr && <p className="vf-err" role="alert">{dlgErr}</p>}
            <div className="stfd-dlg-btns">
              <button type="button" className="vf-btn ghost" onClick={() => setMoving(null)} disabled={busy}>Cancel</button>
              <button className="vf-btn red" disabled={busy || !moving}>{busy ? "Moving" : "Move premiere"}</button>
            </div>
          </form>
        </div>
      )}
      {withdrawing !== null && plan && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-labelledby="stfd-wd" onClick={(e) => e.target === e.currentTarget && !busy && setWithdrawing(null)}>
          <form className="stfd-dlg" onSubmit={(e) => { e.preventDefault(); void withdraw(); }}>
            <h2 id="stfd-wd">Withdraw {u.title}?</h2>
            <p>The premiere comes off sale now and every ticket is refunded the way it was paid. Holders get an email as their refund goes out. This cannot be undone.</p>
            <div className="stfd-dlg-k">
              <div><span>Seats to refund</span><b>{plan.seats.toLocaleString("en-GB")}</b></div>
              <div><span>Ticket money returned</span><b>{usd(plan.grossCents)}</b></div>
            </div>
            <label className="vf-field"><span>Type WITHDRAW to confirm</span><div className="vf-box"><input value={withdrawing} onChange={(e) => setWithdrawing(e.target.value)} autoComplete="off" autoFocus /></div></label>
            <small className="stfd-dlg-hint">Only the studio owner can withdraw a film.</small>
            {dlgErr && <p className="vf-err" role="alert">{dlgErr}</p>}
            <div className="stfd-dlg-btns">
              <button type="button" className="vf-btn ghost" onClick={() => setWithdrawing(null)} disabled={busy}>Keep it on sale</button>
              <button className="vf-btn red" disabled={busy || withdrawing.trim().toUpperCase() !== "WITHDRAW"}>{busy ? "Withdrawing" : "Withdraw and refund"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
