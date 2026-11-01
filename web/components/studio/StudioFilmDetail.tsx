"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Upload, UploadFile } from "@/lib/studio-types";
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
  rows.push({ title: "Watermark", detail: "Per-viewer forensic mark", pill: { tone: "grey", text: "Soon" } });
  return rows;
}

export default function StudioFilmDetail({ upload: u0, canEdit, rightsDeclared }: { upload: Upload; canEdit: boolean; rightsDeclared: boolean }) {
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

  const rows = statusRows(u, rightsDeclared);
  return (
    <div className="pt-body stfd">
      <header className="bp-head">
        <div>
          <h1>{u.title}</h1>
          <p>{[u.genres.split(",")[0]?.trim(), runtime, u.languages, "no premiere booked yet"].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="pt-btns">
          <span className="vf-btn ghost stu-soon" aria-disabled="true">Preview as viewer <em className="soon-tag">Soon</em></span>
          {canEdit && <button className="vf-btn red" form="stfd-form" disabled={busy || !changed || !d.title.trim()}>{busy ? "Saving" : "Save changes"}</button>}
        </div>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <nav className="bp-chips" aria-label="Film sections">
        <span className="on" aria-current="page">Details</span>
        <Link href={`/studio/upload/${u.id}`}>Media</Link>
        {["Languages", "Pricing", "Rights", "Pre-sales"].map((c) => <span key={c} className="off" aria-disabled="true" title="Coming soon">{c}</span>)}
      </nav>

      <div className="stfd-two">
        <div className="stfd-col">
          <section className="bp-panel">
            <h2>Details</h2>
            <form id="stfd-form" className="stfd-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="vf-field"><span>Title</span><div className="vf-box"><input value={d.title} onChange={set("title")} maxLength={120} required disabled={!canEdit} /></div></label>
              <label className="vf-field"><span>Logline</span><div className="vf-box"><input value={d.logline} onChange={set("logline")} maxLength={300} placeholder="One sentence that makes someone want a seat" disabled={!canEdit} /></div></label>
              <div className="stfd-pair">
                <label className="vf-field"><span>Genre</span><div className="vf-box"><input value={d.genres} onChange={set("genres")} maxLength={80} placeholder="Drama, thriller" disabled={!canEdit} /></div></label>
                <label className="vf-field"><span>Age rating</span><div className="vf-box"><input value={d.ageRating} onChange={set("ageRating")} maxLength={60} placeholder={suggestion ? suggestion.split(" (")[0] : "16+ (NFVCB)"} disabled={!canEdit} /></div></label>
              </div>
              {suggestion && !d.ageRating && <p className="pt-hint">AI suggests {suggestion} from your subtitles. You decide the rating.</p>}
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
              <button type="button" className="stfd-poster" onClick={() => canEdit && pick.current?.click()} disabled={!canEdit} aria-label={u.posterKey ? "Change poster" : "Add a poster"}>
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
              <div className="bp-kpi"><span>Seats sold</span><b>0</b><em className="muted">on sale once the premiere is booked</em></div>
              <div className="bp-kpi"><span>Gross</span><b>–</b><em className="muted">70% to you</em></div>
            </div>
          </section>
          <section className="bp-panel">
            <h2>Danger zone</h2>
            <div className="stfd-v">
              <div><b>Move the premiere</b><small>No premiere booked yet. Ticket holders get a free change or a refund</small></div>
              <button className="vf-btn sm sec" disabled>Reschedule</button>
            </div>
            {canEdit && (
              <div className="stfd-v">
                <div><b>Delete this draft</b><small>It has not premiered, so no one holds a ticket. Every uploaded file is deleted</small></div>
                <button className="vf-btn sm ghost" onClick={remove}>Delete</button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
