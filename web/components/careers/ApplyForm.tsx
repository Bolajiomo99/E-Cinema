"use client";
import Link from "next/link";
import { useRef, useState } from "react";

// The apply form beside a role (Figma 114:1397): details, a PDF CV and an optional note.
export default function ApplyForm({ slug, quota, name, email, country, countries }: {
  slug: string; quota: "ng" | "world"; name: string; email: string; country: string; countries: [string, string][];
}) {
  const [f, setF] = useState({ name, email, country, link: "", why: "", keep: true, ngEligible: false });
  const [cv, setCv] = useState<{ key: string; name: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((v) => ({ ...v, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function upload(file?: File) {
    if (!file) return;
    setErr("");
    if (file.type !== "application/pdf" || file.size > 5 << 20) return setErr("Your CV must be a PDF up to 5 MB");
    setBusy("cv");
    const body = new FormData();
    body.append("file", file);
    const r = await fetch("/api/careers/cv", { method: "POST", body });
    const b = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setErr(b.error ?? "Upload failed");
    setCv({ key: b.key, name: b.name });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!cv) return setErr("Add your CV first");
    setBusy("send");
    const r = await fetch(`/api/careers/jobs/${slug}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, cvKey: cv.key }) });
    const b = await r.json().catch(() => ({}));
    setBusy("");
    if (!r.ok) return setErr(b.error ?? "Could not send. Try again.");
    setDone(true);
  }

  if (done) return (
    <div className="rf-note ok" role="status">
      <b>Application sent.</b> We emailed you a copy. You hear back within 10 working days. <Link href="/careers/applications">Track it in My applications</Link>
    </div>
  );
  const needsTick = quota === "ng" && f.country !== "NG";
  return (
    <form className="jd-form" onSubmit={submit}>
      <label><span>Full name</span><input required maxLength={100} value={f.name} onChange={set("name")} autoComplete="name" /></label>
      <label><span>Email</span><input required type="email" maxLength={200} value={f.email} onChange={set("email")} autoComplete="email" /></label>
      <label><span>Country you live in</span>
        <select required value={f.country} onChange={set("country")}><option value="">Choose a country</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      </label>
      {needsTick && f.country && (
        <label className="jd-check"><input type="checkbox" checked={f.ngEligible} onChange={set("ngEligible")} /> I am a Nigerian citizen</label>
      )}
      <label><span>LinkedIn or portfolio</span><input maxLength={300} value={f.link} onChange={set("link")} placeholder="github.com/yourname" inputMode="url" /></label>
      <div
        className={`jd-drop ${drag ? "drag" : ""} ${cv ? "has" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
      >
        <input ref={input} type="file" accept="application/pdf" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <button type="button" onClick={() => input.current?.click()} disabled={busy === "cv"}>
          {busy === "cv" ? "Uploading…" : cv ? `CV added: ${cv.name}` : "Drop your CV here (PDF, up to 5 MB)"}
        </button>
        <small>{cv ? "Click to replace it" : "Checked to be a plain PDF and stored privately"}</small>
      </div>
      <label><span>Why E-Cinema? (optional)</span><textarea rows={4} maxLength={1500} value={f.why} onChange={set("why")} /></label>
      <label className="jd-check"><input type="checkbox" checked={f.keep} onChange={set("keep")} /> Keep me in mind for other roles</label>
      {err && <p className="rf-note bad" role="alert">{err}</p>}
      <button className="vf-btn red jd-send" type="submit" disabled={Boolean(busy) || (needsTick && !f.ngEligible)}>{busy === "send" ? "Sending…" : "Send application"}</button>
      {needsTick && !f.ngEligible && <p className="jd-muted">{"This role is kept for Nigerian citizens and people living in Nigeria."}</p>}
      <p className="jd-muted">We check every application by hand. AI only helps sort, never rejects.</p>
    </form>
  );
}
