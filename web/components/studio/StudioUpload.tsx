"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ago, bytes, partCount, partSize, UPLOAD_ACCEPT, type Upload, type UploadCheck, type UploadFile } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / Upload · film file" (35:290). Files go straight from the browser to private
// storage in parts, four at a time; choosing the same file again carries on where it stopped.
const STEPS = ["Film file", "Details", "Rights", "Dubbing", "Premiere", "Review"];
const ORDER: UploadFile["kind"][] = ["master", "trailer", "stems", "subtitles", "package"];
const LATER: UploadCheck = { state: "soon", text: "Sync, loudness, burnt-in subtitle and dark-scene checks" };
const PARALLEL = 4;

type Live = { sent: number; total: number; startedAt: number; startSent: number; error?: string; finishing?: boolean };

const ucall = <T,>(method: string, path: string, body?: unknown) => scall<T>(method, `uploads${path ? "/" + path : ""}`, body);

function eta(l: Live, now: number) {
  const secs = (now - l.startedAt) / 1000, rate = (l.sent - l.startSent) / Math.max(1, secs);
  if (secs < 3 || rate <= 0) return "";
  const left = (l.total - l.sent) / rate;
  return left < 90 ? `${Math.max(1, Math.round(left))} s left` : left < 5400 ? `${Math.round(left / 60)} min left` : `${Math.round(left / 3600)} h left`;
}

// Sends one part with progress, and returns the ETag storage gives back.
function putPart(url: string, blob: Blob, onProgress: (n: number) => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => {
      const tag = x.getResponseHeader("ETag");
      if (x.status >= 200 && x.status < 300 && tag) resolve(tag);
      else reject(Object.assign(new Error(x.status === 403 ? "expired" : `storage ${x.status}`), { status: x.status }));
    };
    x.onerror = () => reject(new Error("network"));
    x.onabort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", () => x.abort(), { once: true });
    x.send(blob);
  });
}

function FileIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#a6a6b0" strokeWidth="1.6" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>;
}

function CheckIcon({ state }: { state: UploadCheck["state"] }) {
  if (state === "ok") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Passed"><path d="m3 8.5 3 3 7-7" /></svg>;
  if (state === "warn") return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#d4a23a" strokeWidth="1.6" strokeLinecap="round" aria-label="Look at this"><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" /></svg>;
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="#6e6e7a" strokeWidth="1.6" aria-label="Coming soon"><circle cx="8" cy="8" r="5.5" /></svg>;
}

export default function StudioUpload({ upload: u0, canEdit, now: now0 }: { upload: Upload; canEdit: boolean; now: number }) {
  const [u, setU] = useState(u0);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [paused, setPaused] = useState<Record<string, number>>({});
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [now, setNow] = useState(now0);
  const input = useRef<HTMLInputElement>(null);
  const stops = useRef<Record<string, AbortController>>({});
  const busy = Object.keys(live).length > 0;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), busy ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // How far each unfinished file got before, so the page can show it as paused.
  useEffect(() => {
    for (const f of u0.files.filter((x) => x.status === "uploading")) {
      ucall<{ parts: { size: number }[] }>("GET", `${u0.id}/files/${f.id}/parts`)
        .then((r) => setPaused((p) => ({ ...p, [f.id]: r.parts.reduce((a, x) => a + x.size, 0) })))
        .catch(() => {});
    }
  }, [u0]);

  const put = (f: UploadFile) => setU((x) => ({ ...x, updatedAt: new Date().toISOString(), files: x.files.some((y) => y.id === f.id) ? x.files.map((y) => (y.id === f.id ? f : y)) : [...x.files, f] }));

  const send = useCallback(async (file: File, rec: UploadFile) => {
    const ctl = new AbortController();
    stops.current[rec.id] = ctl;
    const size = file.size, ps = partSize(size), n = partCount(size);
    const have = await ucall<{ parts: { part: number; size: number }[] }>("GET", `${u.id}/files/${rec.id}/parts`).catch(() => ({ parts: [] }));
    const done = new Set(have.parts.filter((p) => p.size === Math.min(ps, size - (p.part - 1) * ps)).map((p) => p.part));
    const base = [...done].reduce((a, p) => a + Math.min(ps, size - (p - 1) * ps), 0);
    const inFlight: Record<number, number> = {};
    let finished = base;
    const tick = () => setLive((l) => ({ ...l, [rec.id]: { ...l[rec.id], sent: finished + Object.values(inFlight).reduce((a, b) => a + b, 0) } }));
    setLive((l) => ({ ...l, [rec.id]: { sent: base, total: size, startedAt: Date.now(), startSent: base } }));
    const todo = Array.from({ length: n }, (_, i) => i + 1).filter((p) => !done.has(p));
    const links = new Map<number, string>();
    const link = async (p: number, fresh = false) => {
      if (fresh || !links.has(p)) {
        const want = [p, ...todo.filter((q) => q > p && !links.has(q))].slice(0, 24);
        const r = await ucall<{ urls: { part: number; url: string }[] }>("POST", `${u.id}/files/${rec.id}/parts`, { parts: want });
        for (const x of r.urls) links.set(x.part, x.url);
      }
      return links.get(p)!;
    };
    try {
      let next = 0;
      const worker = async () => {
        while (next < todo.length && !ctl.signal.aborted) {
          const p = todo[next++];
          const blob = file.slice((p - 1) * ps, Math.min(size, p * ps));
          for (let attempt = 0; ; attempt++) {
            try {
              await putPart(await link(p, attempt > 0), blob, (sent) => { inFlight[p] = sent; tick(); }, ctl.signal);
              break;
            } catch (e) {
              if (ctl.signal.aborted || attempt >= 4) throw e;
              inFlight[p] = 0;
              await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            }
          }
          delete inFlight[p];
          finished += blob.size;
          tick();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
      if (ctl.signal.aborted) throw new Error("aborted");
      setLive((l) => ({ ...l, [rec.id]: { ...l[rec.id], sent: size, finishing: true } }));
      const r = await ucall<{ file: UploadFile }>("POST", `${u.id}/files/${rec.id}/complete`);
      put(r.file);
      setLive((l) => { const c = { ...l }; delete c[rec.id]; return c; });
    } catch (e) {
      const m = (e as Error).message;
      setPaused((p) => ({ ...p, [rec.id]: finished }));
      setLive((l) => { const c = { ...l }; delete c[rec.id]; return c; });
      if (m !== "aborted") setErr(`${file.name} stopped: ${m === "network" ? "the connection dropped" : m}. Choose it again to carry on.`);
    } finally {
      delete stops.current[rec.id];
    }
  }, [u.id]);

  async function choose(list: FileList | File[]) {
    setErr(""); setMsg("");
    for (const file of Array.from(list)) {
      if (!file.size) { setErr(`${file.name} is empty`); continue; }
      const same = u.files.find((f) => f.name === file.name.replace(/[/\\]/g, "_") && f.size === file.size);
      if (same?.status === "uploaded") { setMsg(`${file.name} is already uploaded.`); continue; }
      if (same && live[same.id]) continue;
      try {
        const rec = same ?? (await ucall<{ file: UploadFile }>("POST", `${u.id}/files`, { name: file.name, size: file.size })).file;
        if (!same) put(rec);
        void send(file, rec);
      } catch (e) { setErr(`${file.name}: ${(e as Error).message}`); }
    }
  }

  async function remove(f: UploadFile) {
    if (!window.confirm(`Remove ${f.name}? ${f.status === "uploaded" ? "The uploaded file is deleted." : "What was sent so far is deleted."}`)) return;
    stops.current[f.id]?.abort();
    try {
      await ucall("DELETE", `${u.id}/files/${f.id}`);
      setU((x) => ({ ...x, files: x.files.filter((y) => y.id !== f.id) }));
    } catch (e) { setErr((e as Error).message); }
  }

  async function saveDraft() {
    setErr("");
    try {
      const r = await ucall<{ upload: Upload }>("PUT", u.id, { title: u.title });
      setU(r.upload);
      setMsg("Draft saved.");
    } catch (e) { setErr((e as Error).message); }
  }

  const files = [...u.files].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const checks = files.flatMap((f) => f.checks);
  const hasMaster = u.files.some((f) => f.kind === "master" && f.status === "uploaded");

  return (
    <div className="pt-body stup">
      <header className="bp-head">
        <div>
          <h1>Upload a film</h1>
          <p>{u.title} · draft saved {ago(u.updatedAt, now)}</p>
        </div>
        <div className="pt-btns">
          {canEdit && <button className="vf-btn ghost" onClick={saveDraft}>Save draft</button>}
          {hasMaster
            ? <Link className="vf-btn red" href={`/studio/films/${u.id}`}>Next: details</Link>
            : <span className="vf-btn red stu-soon" aria-disabled="true" title="Upload your master first">Next: details</span>}
        </div>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}

      <ol className="stup-steps" aria-label="Upload steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === 0 ? "on" : ""} aria-current={i === 0 ? "step" : undefined}>
            {i === 1 ? <Link href={`/studio/films/${u.id}`}><b>{i + 1}</b><span>{s}</span></Link> : <><b>{i + 1}</b><span>{s}</span></>}
            {i < STEPS.length - 1 && <i />}
          </li>
        ))}
      </ol>

      <div className="stup-row">
        <div className="stup-l">
          {canEdit ? (
            <div
              className={`stup-drop ${over ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void choose(e.dataTransfer.files); }}
            >
              <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#d4a23a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
              <b>Drop your master here, or connect Aspera, Frame.io or an S3 bucket <em className="soon-tag">Soon</em></b>
              <small>ProRes 4444, DNxHR or IMF package · up to 2 TB · resumable upload</small>
              <button className="vf-btn sm sec" onClick={() => input.current?.click()}>Choose files</button>
              <input ref={input} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => { if (e.target.files) void choose(e.target.files); e.target.value = ""; }} />
            </div>
          ) : <p className="pt-hint">Only the owner and admins can upload films. You can follow the upload here.</p>}
          {err && <p className="vf-err" role="alert">{err}</p>}

          <section className="bp-panel stup-files">
            <h2>Files</h2>
            {files.length ? files.map((f) => {
              const l = live[f.id];
              const sent = l ? l.sent : f.status === "uploaded" ? f.size : paused[f.id] ?? 0;
              const pct = Math.min(100, Math.floor((sent / f.size) * 100));
              const state = f.status === "uploaded" ? <em className="ok">Uploaded</em>
                : f.status === "failed" ? <em className="bad">Not accepted</em>
                : l ? <em>{l.finishing ? "Checking the file" : `Uploading ${pct}%${eta(l, now) ? " · " + eta(l, now) : ""}`}</em>
                : <em>{`Paused at ${pct}% · choose the file again to carry on`}</em>;
              return (
                <div key={f.id} className="stup-file">
                  <span className="stup-ic"><FileIcon /></span>
                  <div className="stup-ft">
                    <div className="stup-fr"><b>{f.name}</b>{state}</div>
                    <div className="stup-bar" role="progressbar" aria-label={`${f.name} upload`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <i className={f.status === "uploaded" ? "ok" : f.status === "failed" ? "bad" : ""} style={{ width: `${f.status === "failed" ? 100 : pct}%` }} />
                    </div>
                    <small>{f.info || `${bytes(f.size)} · ${f.kind === "master" ? "film master" : f.kind === "stems" ? "audio stems" : f.kind === "package" ? "IMF package" : f.kind}`}</small>
                  </div>
                  {canEdit && <button className="stup-x" aria-label={`Remove ${f.name}`} onClick={() => remove(f)}>×</button>}
                </div>
              );
            }) : <p className="pt-empty">Your master, audio stems, subtitles and trailer show here as they upload.</p>}
          </section>
        </div>

        <div className="stup-r">
          <section className="bp-panel">
            <h2>AI checks while you upload</h2>
            <ul className="stup-checks">
              {checks.map((c, i) => <li key={i}><CheckIcon state={c.state} /><span>{c.text}</span></li>)}
              {!checks.length && <li><CheckIcon state="soon" /><span>Checks start as soon as your first file is in: picture size, codec, frame rate and HDR of the master, stem channels, subtitle timing and an age rating suggestion.</span></li>}
              <li><CheckIcon state={LATER.state} /><span>{LATER.text} <em className="soon-tag">Soon</em></span></li>
            </ul>
          </section>
          <section className="bp-panel">
            <h2>What happens next</h2>
            <p className="stup-next">We encode 9 quality levels from 240p to 4K, AV1 and HEVC, then lock it with DRM and per-viewer watermarks. Your original master is stored encrypted and never shared.</p>
            <p className="pt-hint">Automatic encoding <em className="soon-tag">Soon</em> Your files are already stored privately and only your studio can see them.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
