"use client";
import { useState } from "react";
import { KIND, STAGES, type Application, type Job, type Quote, type Stage } from "@/lib/careers-types";

const EMPTY: Job = { slug: "", title: "", team: "", city: "", country: "NG", remote: false, kind: "full", quota: "ng", pay: "", setup: "", about: "", bring: "", open: true, createdAt: "" };
const NEXT: Record<string, Stage> = { received: "chat", chat: "task", task: "team", team: "offer", offer: "hired" };

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const r = await fetch(`/api/careers/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

export default function HiringDesk({ jobs: j0, apps: a0, quotes: q0, share: s0, countries }: { jobs: Job[]; apps: Application[]; quotes: Quote[]; share: number; countries: [string, string][] }) {
  const [jobs, setJobs] = useState(j0);
  const [apps, setApps] = useState(a0);
  const [quotes, setQuotes] = useState(q0);
  const [share, setShare] = useState(String(s0));
  const [edit, setEdit] = useState<Job>(EMPTY);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [move, setMove] = useState<{ message: string; interviewAt: string; interviewWith: string; taskDue: string; taskPay: string }>({ message: "", interviewAt: "", interviewWith: "", taskDue: "", taskPay: "" });
  const setJ = (k: keyof Job) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setEdit((v) => ({ ...v, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function saveJob(e: React.FormEvent) {
    e.preventDefault();
    const slug = edit.slug || edit.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const r = await call<Job>("PUT", `desk/jobs/${slug}`, { ...edit, slug });
    if (!r.ok) return setMsg(r.data.error ?? "Could not save");
    setJobs((l) => [r.data, ...l.filter((x) => x.slug !== r.data.slug)]);
    setEdit(EMPTY);
    setMsg(`Saved ${r.data.title}`);
  }
  async function toggle(j: Job) {
    const r = await call<Job>("PUT", `desk/jobs/${j.slug}`, { ...j, open: !j.open });
    if (r.ok) setJobs((l) => l.map((x) => (x.slug === j.slug ? { ...r.data, applied: j.applied } : x)));
  }
  async function saveShare() {
    const r = await call("PUT", "desk/share", { ngShare: Number(share) });
    setMsg(r.ok ? `Nigeria share set to ${share}%` : r.data.error ?? "Could not save");
  }
  async function advance(a: Application, stage: Stage | "") {
    const body: Record<string, unknown> = { stage, message: move.message, interviewWith: move.interviewWith, taskPay: move.taskPay };
    if (move.interviewAt) body.interviewAt = new Date(move.interviewAt).toISOString();
    if (move.taskDue) body.taskDue = new Date(move.taskDue).toISOString();
    const r = await call<{ application: Application }>("POST", `desk/applications/${a.id}`, body);
    if (!r.ok) return setMsg(r.data.error ?? "Could not update");
    setApps((l) => l.map((x) => (x.id === a.id ? r.data.application : x)));
    setMove({ message: "", interviewAt: "", interviewWith: "", taskDue: "", taskPay: "" });
    setMsg(`${a.name} is now at ${r.data.application.stage}. They were emailed.`);
  }
  async function quote(q: Quote, status: string) {
    const r = await call("POST", `desk/quotes/${q.id}`, { status });
    if (r.ok) setQuotes((l) => l.map((x) => (x.id === q.id ? { ...x, status } : x)));
  }
  const stageName = (s: string) => STAGES.find(([k]) => k === s)?.[1] ?? (s === "hired" ? "Hired" : "Closed");

  return (
    <div className="hd">
      {msg && <p className="rf-note ok" role="status">{msg}</p>}
      <section className="hd-box">
        <h2>Share kept for Nigeria</h2>
        <div className="hd-row">
          <input type="number" min={0} max={100} value={share} onChange={(e) => setShare(e.target.value)} aria-label="Percent of roles kept for Nigeria" />
          <span>% of roles for Nigeria, the rest open worldwide.</span>
          <button className="vf-btn ghost" type="button" onClick={saveShare}>Save</button>
        </div>
        <small>Open now: {jobs.filter((j) => j.open && j.quota === "ng").length} Nigeria, {jobs.filter((j) => j.open && j.quota === "world").length} worldwide.</small>
      </section>

      <section className="hd-box">
        <h2>{edit.createdAt ? `Edit ${edit.title}` : "Post a role"}</h2>
        <form className="qf" onSubmit={saveJob}>
          <label><span>Title</span><input required maxLength={120} value={edit.title} onChange={setJ("title")} /></label>
          <label><span>Team</span><input required maxLength={40} value={edit.team} onChange={setJ("team")} placeholder="Platform" /></label>
          <label><span>City</span><input required maxLength={80} value={edit.city} onChange={setJ("city")} placeholder="Lagos" /></label>
          <label><span>Country</span><select value={edit.country} onChange={setJ("country")}>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label><span>Type</span><select value={edit.kind} onChange={setJ("kind")}>{Object.entries(KIND).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          <label><span>Who can apply</span><select value={edit.quota} onChange={setJ("quota")}><option value="ng">Kept for Nigeria</option><option value="world">Open worldwide</option></select></label>
          <label><span>Pay (optional)</span><input maxLength={80} value={edit.pay} onChange={setJ("pay")} placeholder="₦18M to ₦26M a year" /></label>
          <label><span>Setup (optional)</span><input maxLength={40} value={edit.setup} onChange={setJ("setup")} placeholder="Hybrid" /></label>
          <label className="qf-wide"><span>What you will do</span><textarea required rows={3} maxLength={2000} value={edit.about} onChange={setJ("about")} /></label>
          <label className="qf-wide"><span>What you bring</span><textarea required rows={3} maxLength={2000} value={edit.bring} onChange={setJ("bring")} /></label>
          <label className="jd-check"><input type="checkbox" checked={edit.remote} onChange={setJ("remote")} /> Remote allowed</label>
          <label className="jd-check"><input type="checkbox" checked={edit.open} onChange={setJ("open")} /> Open for applications</label>
          <div className="qf-wide qf-row"><button className="vf-btn red" type="submit">{edit.createdAt ? "Save role" : "Post role"}</button>{edit.createdAt && <button className="vf-btn ghost" type="button" onClick={() => setEdit(EMPTY)}>Cancel</button>}</div>
        </form>
      </section>

      <section className="hd-box">
        <h2>Roles</h2>
        {jobs.length === 0 && <p className="jd-muted">No roles posted yet.</p>}
        {jobs.map((j) => (
          <div key={j.slug} className="hd-item">
            <div><b>{j.title}</b><small>{j.team} · {j.city} · {j.quota === "ng" ? "Nigeria" : "Worldwide"} · {j.applied ?? 0} applied · {j.open ? "open" : "closed"}</small></div>
            <button className="vf-btn ghost" type="button" onClick={() => setEdit(j)}>Edit</button>
            <button className="vf-btn ghost" type="button" onClick={() => toggle(j)}>{j.open ? "Close" : "Reopen"}</button>
          </div>
        ))}
      </section>

      <section className="hd-box">
        <h2>Applicants</h2>
        {apps.length === 0 && <p className="jd-muted">No applications yet.</p>}
        {apps.map((a) => {
          const done = a.stage === "hired" || a.stage === "closed";
          return (
            <div key={a.id} className="hd-item col">
              <div className="hd-row">
                <div><b>{a.name} · {a.job.title}</b><small>{a.email} · {a.country}{a.ngEligible && a.country !== "NG" ? " · Nigerian citizen" : ""} · {stageName(a.stage)}{a.link ? ` · ${a.link}` : ""}</small></div>
                <a className="vf-btn ghost" href={`/api/careers/desk/cv/${a.id}`} target="_blank" rel="noopener noreferrer">CV</a>
                {!done && <button className="vf-btn ghost" type="button" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "Hide" : "Move"}</button>}
              </div>
              {a.why && <p className="jd-muted">“{a.why}”</p>}
              {open === a.id && !done && (
                <div className="qf">
                  <label className="qf-wide"><span>Message to the applicant</span><textarea rows={2} maxLength={1000} value={move.message} onChange={(e) => setMove((m) => ({ ...m, message: e.target.value }))} /></label>
                  <label><span>Interview time</span><input type="datetime-local" value={move.interviewAt} onChange={(e) => setMove((m) => ({ ...m, interviewAt: e.target.value }))} /></label>
                  <label><span>Interview with</span><input maxLength={120} value={move.interviewWith} onChange={(e) => setMove((m) => ({ ...m, interviewWith: e.target.value }))} placeholder="Amaka (Head of Platform)" /></label>
                  <label><span>Task due</span><input type="date" value={move.taskDue} onChange={(e) => setMove((m) => ({ ...m, taskDue: e.target.value }))} /></label>
                  <label><span>Task pay</span><input maxLength={80} value={move.taskPay} onChange={(e) => setMove((m) => ({ ...m, taskPay: e.target.value }))} placeholder="₦150,000 for your time" /></label>
                  <div className="qf-wide qf-row">
                    <button className="vf-btn red" type="button" onClick={() => advance(a, NEXT[a.stage])}>Move to {stageName(NEXT[a.stage]) }</button>
                    <button className="vf-btn ghost" type="button" onClick={() => advance(a, "")}>Update without moving</button>
                    <button className="vf-btn ghost" type="button" onClick={() => advance(a, "closed")}>Close kindly</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="hd-box" id="quotes">
        <h2>Group screening quotes</h2>
        {quotes.length === 0 && <p className="jd-muted">No quote requests yet.</p>}
        {quotes.map((q) => (
          <div key={q.id} className="hd-item">
            <div><b>{q.organisation} · {q.guests.toLocaleString("en-GB")} guests · {q.country}</b><small>{q.email} · {q.kind || "group"} · {new Date(q.createdAt).toLocaleDateString("en-GB")}{q.note ? ` · ${q.note}` : ""}</small></div>
            <select value={q.status} onChange={(e) => quote(q, e.target.value)} aria-label={`Status for ${q.organisation}`}>
              {["new", "contacted", "won", "lost"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ))}
      </section>
    </div>
  );
}
