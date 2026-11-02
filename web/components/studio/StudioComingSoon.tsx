"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Premiere } from "@/lib/premiere-types";
import type { Upload } from "@/lib/studio-types";
import { PREORDER_STAGES } from "@/lib/ticket-quote";
import { scall } from "./scall";

// Figma "Studio / Post a coming-soon film" (53:1512). A studio announces a film ahead of release
// and sells seats early at a lower price that rises in stages. The full film can come later, as
// long as release is at least a week away while the master is missing.

const KINDS = ["Movie", "Series"];
const GENRES = ["Action", "Thriller", "Drama", "Comedy", "Romance", "Horror", "Sci-fi", "Fantasy", "Family", "Documentary", "Anime", "Cartoon", "Nollywood", "Bollywood", "K-Drama"];
const FORMATS: { id: string; label: string; soon?: boolean }[] = [
  { id: "hd", label: "1080p Full HD" }, { id: "uhd", label: "4K HDR" }, { id: "atmos", label: "Dolby Atmos" }, { id: "vr", label: "VR cinema seat" },
  { id: "ar", label: "AR wall screen", soon: true }, { id: "3d", label: "3D", soon: true },
];
const IN_MONTHS = [1, 2, 3, 6, 12];
const DAY = 86_400_000;
const LAGOS = 60 * 60_000; // UTC+1, no daylight saving

// The release moment as a Lagos date and time, written by hand so server and browser agree.
function toLagos(iso: string | null) {
  if (!iso) return { date: "", time: "20:00" };
  const d = new Date(Date.parse(iso) + LAGOS).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
const fromLagos = (date: string, time: string) => (date ? new Date(Date.parse(`${date}T${time || "20:00"}:00Z`) - LAGOS).toISOString() : "");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (iso: string) => { const d = new Date(Date.parse(iso) + LAGOS); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const shortDay = (ms: number) => { const d = new Date(ms + LAGOS); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase()}`; };
const usd = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

function splitGenres(g: string) {
  const parts = g.split(",").map((x) => x.trim()).filter(Boolean);
  return { kind: parts.includes("Series") ? "Series" : "Movie", genre: parts.find((x) => GENRES.includes(x)) ?? "Drama", rest: parts.filter((x) => x !== "Series" && !GENRES.includes(x)) };
}

export default function StudioComingSoon({ upload, premiere, canEdit, rightsDeclared }: { upload: Upload | null; premiere: Premiere | null; canEdit: boolean; rightsDeclared: boolean }) {
  const router = useRouter();
  const g = splitGenres(upload?.genres ?? "");
  const at = toLagos(premiere?.startsAt ?? null);
  const [title, setTitle] = useState(upload?.title ?? "");
  const [kind, setKind] = useState(g.kind);
  const [genre, setGenre] = useState(g.genre);
  const [date, setDate] = useState(at.date);
  const [time, setTime] = useState(at.time);
  const [price, setPrice] = useState(String((premiere?.priceCents ?? 499) / 100));
  const [save, setSave] = useState(premiere?.comingSoon ? premiere.earlySave : 38);
  const [formats, setFormats] = useState<string[]>(premiere?.formats?.length ? premiere.formats : ["hd"]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(0);
  useEffect(() => { const t = setTimeout(() => setNow(Date.now()), 0); return () => clearTimeout(t); }, []);

  const startsAt = fromLagos(date, time);
  const start = startsAt ? Date.parse(startsAt) : 0;
  const cents = Math.round((Number(price) || 0) * 100);
  const master = upload?.files.some((f) => f.kind === "master" && f.status === "uploaded") ?? false;
  const trailer = upload?.files.some((f) => f.kind === "trailer" && f.status === "uploaded") ?? false;
  const live = Boolean(premiere?.publishedAt);
  const tiles = [
    ...PREORDER_STAGES.map((st) => ({ label: start ? `UNTIL ${shortDay(start - st.untilDays * DAY)}` : `${st.untilDays}+ DAYS OUT`, pct: Math.round(save * st.share) })),
    { label: "RELEASE", pct: 0 },
  ];
  const blockers = [
    !title.trim() && "add the title",
    !start && "pick the release date",
    start > 0 && now > 0 && !master && start - now < 7 * DAY && "pick a release at least 7 days away, or upload the full film first",
    !rightsDeclared && "declare your rights in Settings",
    (cents < 99 || cents > 10000) && "set a release price between $0.99 and $100",
  ].filter(Boolean) as string[];

  function setIn(months: number) {
    const d = new Date(Date.now() + LAGOS);
    d.setUTCMonth(d.getUTCMonth() + months);
    setDate(d.toISOString().slice(0, 10));
  }

  async function submit(publish: boolean) {
    setBusy(publish ? "publish" : "save"); setErr(""); setMsg("");
    try {
      let u = upload;
      if (!u) u = (await scall<{ upload: Upload }>("POST", "uploads", { title: title.trim() })).upload;
      const genres = [genre, ...(kind === "Series" ? ["Series"] : []), ...splitGenres(u.genres).rest].join(", ");
      await scall("PUT", `uploads/${u.id}/details`, { title: title.trim(), logline: u.logline, genres, ageRating: u.ageRating, castCrew: u.castCrew, languages: u.languages });
      await scall("PUT", `uploads/${u.id}/coming-soon`, { earlySave: save, formats });
      // The rest of the premiere plan stays as the studio set it on Premieres and pricing.
      const p = premiere;
      const rt = u.files.find((f) => f.kind === "master" && f.status === "uploaded")?.info.match(/(?:(\d+)h )?(\d+)m(?: \d+s)?$/);
      await scall("PUT", `uploads/${u.id}/premiere`, {
        mode: "global", startsAt, seats: p?.seats ?? 5000, encores: p?.encores ?? 2, priceCents: cents,
        freeSeats: p?.freeSeats ?? true, freePlan: p?.freePlan ?? true, groupDiscounts: p?.groupDiscounts ?? true, studentPrice: p?.studentPrice ?? true,
        classicRequests: p?.classicRequests ?? true, downloads: p?.downloads ?? false, prices: p?.prices ?? [],
        durationMin: rt ? Number(rt[1] ?? 0) * 60 + Number(rt[2]) : 120, publish,
      });
      if (!upload) { router.replace(`/studio/premieres/coming-soon?film=${u.id}`); router.refresh(); }
      else router.refresh();
      setMsg(publish ? "Published. The film is on Coming soon and early seats are on sale." : "Draft saved.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  return (
    <div className="pt-body stcs">
      <header className="bp-head">
        <div>
          <h1>Post a coming-soon film</h1>
          <p>Announce a film weeks, months or years ahead and sell early tickets at a lower price.</p>
        </div>
        {canEdit && (
          <div className="pt-btns">
            <button type="button" className="vf-btn ghost" disabled={Boolean(busy) || !title.trim()} onClick={() => submit(false)}>{busy === "save" ? "Saving" : "Save draft"}</button>
            <button type="button" className="vf-btn red" disabled={Boolean(busy) || blockers.length > 0} onClick={() => submit(true)}>{busy === "publish" ? "Publishing" : live ? "Publish changes" : "Publish to Coming soon"}</button>
          </div>
        )}
      </header>
      {live && premiere?.showtimeId && <p className="bp-flash" role="status">On Coming soon · <Link href={`/preorder/${premiere.showtimeId}`}>see the pre-order page</Link>{premiere.sold ? ` · ${premiere.sold.toLocaleString("en-US")} seats sold` : ""}</p>}
      {canEdit && !live && blockers.length > 0 && title.trim() && <p className="pt-hint">To publish, {blockers.join(", ")}.</p>}
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <div className="stcs-grid">
        <div className="stcs-col">
          <section className="bp-panel" aria-label="Film">
            <h2>Film</h2>
            <div className="stcs-two">
              <label className="vf-field"><span>Title</span><div className="vf-box"><input value={title} maxLength={120} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} placeholder="Iron Delta" /></div></label>
              <label className="vf-field"><span>Type</span><div className="vf-box stcs-type">
                <select aria-label="Kind" value={kind} disabled={!canEdit} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                <span aria-hidden>·</span>
                <select aria-label="Genre" value={genre} disabled={!canEdit} onChange={(e) => setGenre(e.target.value)}>{GENRES.map((k) => <option key={k}>{k}</option>)}</select>
              </div></label>
              <label className="vf-field"><span>Release date</span><div className="vf-box stcs-date">
                <input type="date" value={date} disabled={!canEdit} onChange={(e) => setDate(e.target.value)} aria-label="Release date" />
                <input type="time" value={time} disabled={!canEdit} onChange={(e) => setTime(e.target.value)} aria-label="Release time, Lagos" />
              </div>{start > 0 && <small className="stcs-note">{longDay(startsAt)}, {time} Lagos time</small>}</label>
              <label className="vf-field"><span>Or release in</span><div className="vf-box"><select value="" disabled={!canEdit} onChange={(e) => e.target.value && setIn(Number(e.target.value))}>
                <option value="">Choose</option>
                {IN_MONTHS.map((m) => <option key={m} value={m}>{m === 12 ? "1 year" : `${m} ${m === 1 ? "month" : "months"}`}</option>)}
              </select></div></label>
            </div>
            <div className="stcs-up">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#e7a93a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
              <span>{upload ? `Trailer ${trailer ? "uploaded" : "not uploaded yet"} · key art ${upload.posterKey ? "uploaded" : "not uploaded yet"} · full film ${master ? "uploaded" : "can come later"}` : "Trailer, key art and teaser clips (the full film can come later)"}</span>
              {upload ? <Link className="vf-btn soft sm" href={`/studio/upload/${upload.id}`}>Upload</Link> : <span className="pt-hint">Save the draft first</span>}
            </div>
          </section>

          <section className="bp-panel" aria-label="Formats you will offer">
            <h2>Formats you will offer</h2>
            <div className="stcs-chips">
              {FORMATS.map((f) => {
                const on = formats.includes(f.id);
                return f.soon ? (
                  <span key={f.id} className="stcs-chip off" aria-disabled="true">{f.label} <em className="soon-tag">Soon</em></span>
                ) : (
                  <button key={f.id} type="button" className={`stcs-chip${on ? " on" : ""}`} aria-pressed={on} disabled={!canEdit}
                    onClick={() => setFormats(on ? formats.filter((x) => x !== f.id) : [...formats, f.id])}>{f.label}</button>
                );
              })}
            </div>
            <p className="pt-hint">VR uses the same master. E-Cinema builds the virtual hall for you.</p>
          </section>
        </div>

        <div className="stcs-col">
          <section className="bp-panel" aria-label="Early-bird pricing">
            <h2>Early-bird pricing (USD)</h2>
            <div className="stcs-two">
              <label className="vf-field"><span>Release price</span><div className="vf-box"><input inputMode="decimal" value={price} disabled={!canEdit} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} /></div></label>
              <label className="vf-field"><span>Early-bird saving</span><div className="vf-box"><select value={save} disabled={!canEdit} onChange={(e) => setSave(Number(e.target.value))}>
                {[0, 10, 15, 20, 25, 30, 35, 38, 40, 45, 50, 60].map((v) => <option key={v} value={v}>{v ? `${v}% off` : "No early price"}</option>)}
              </select></div></label>
            </div>
            <div className="stcs-tiles">
              {tiles.map((t) => (
                <div key={t.label} className="stcs-tile">
                  <small>{t.label}</small>
                  <b>{usd(Math.round(cents * (1 - t.pct / 100)))}</b>
                  <span>{t.pct ? `−${t.pct}%` : "full"}</span>
                </div>
              ))}
            </div>
            <p className="pt-hint">Country prices you set on <Link href={upload ? `/studio/premieres?film=${upload.id}` : "/studio/premieres"}>Premieres and pricing</Link> get the same early-bird saving.</p>
          </section>

          <section className="bp-panel" aria-label="When you publish">
            <h2>When you publish</h2>
            <ul className="stcs-list">
              <li>Film appears on Coming soon in every country</li>
              <li>Early seats go on sale at the early-bird price, rising in stages to release</li>
              <li>Seat money is paid out after the premiere (70% to you)</li>
              <li>Followers and fans of the genre get a notification <em className="soon-tag">Soon</em></li>
              <li>Refunds handled automatically if you move the date <em className="soon-tag">Soon</em></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
