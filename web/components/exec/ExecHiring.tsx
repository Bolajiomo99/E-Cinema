"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { HiringData } from "@/lib/exec";
import { KIND, type Job } from "@/lib/careers-types";
import { countryName } from "@/lib/worldmap";

// Hiring and jobs (Figma 117:948). The CEO and COO post roles here; only the CEO changes the quota.
const STAGE: Record<string, string> = { received: "Applied", chat: "Recruiter chat", task: "Paid task", team: "Team meeting", offer: "Offer", hired: "Hired" };
const EMPTY: Job = { slug: "", title: "", team: "", city: "", country: "NG", remote: false, kind: "full", quota: "ng", pay: "", setup: "", about: "", bring: "", open: true, createdAt: "" };

function slugFor(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "role";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`; // never overwrites a role with the same title
}

export default function ExecHiring({ d, countries }: { d: HiringData; countries: [string, string][] }) {
  const router = useRouter();
  const [post, setPost] = useState<Job | null>(null);
  const [quota, setQuota] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const dest = Object.entries(d.byCountry).sort((a, b) => b[1] - a[1]);
  const maxC = Math.max(1, ...dest.map((x) => x[1]));
  const set = (k: keyof Job) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setPost((j) => (j ? { ...j, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value } : j));

  async function savePost(e: React.FormEvent) {
    e.preventDefault();
    if (!post) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/executive/jobs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...post, slug: slugFor(post.title) }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { title?: string; slug?: string; error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not post the role"); return; }
    setPost(null); setMsg(`${b.title} is live on the careers page.`);
    router.refresh();
  }
  async function saveQuota() {
    if (quota === null) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/executive/hiring/share", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ngShare: quota }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not change the quota"); return; }
    setQuota(null); setMsg(`The quota is now ${quota}% Nigeria.`);
    router.refresh();
  }

  return (
    <section className="exc exh">
      <header className="exc-head">
        <div>
          <h1>Hiring and jobs</h1>
          <p className="exc-sub">Every open role, every country. {d.ngShare}% of roles are kept for Nigeria, {100 - d.ngShare}% open to the world.</p>
        </div>
        <div className="epf-acts">
          {d.canQuota && <button type="button" className="exa-ghost" onClick={() => { setQuota(d.ngShare); setErr(""); }}>Change the quota</button>}
          {d.canPost && <button type="button" className="exa-red" onClick={() => { setPost({ ...EMPTY }); setErr(""); }}>Post a role</button>}
        </div>
      </header>
      {msg && <p className="exa-msg" role="status">{msg}</p>}

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Open roles</span><b>{d.open}</b><small className="up">{d.openNg} Nigeria · {d.open - d.openNg} worldwide</small></div>
        <div className="exc-tile"><span>Applications</span><b>{d.appsQuarter.toLocaleString("en-US")}</b><small className="up">this quarter, {d.countries} countr{d.countries === 1 ? "y" : "ies"}</small></div>
        <div className="exc-tile"><span>Hired this year</span><b>{d.hiredYear}</b><small className="up">{d.hiredYear ? `Nigeria ${Math.round((d.hiredNg / d.hiredYear) * 100)}%` : "no hires yet"}</small></div>
        <div className="exc-tile"><span>Time to hire</span><b className="exr-big">{d.daysToHire ? `${d.daysToHire} day${d.daysToHire === 1 ? "" : "s"}` : "–"}</b><small className="up">target 25</small></div>
      </div>

      <div className="exc-row exh-row">
        <div className="exc-card">
          <h2>Nigeria share of open roles by team (target {d.ngShare}%)</h2>
          {d.teams.length === 0 && <p className="exc-empty">No open roles yet.</p>}
          {d.teams.map((t) => {
            const pct = Math.round((t.ng / t.total) * 100);
            return <div key={t.team} className="exf-sig exh-bar"><span>{t.team}</span><i><em style={{ width: `${pct}%`, background: pct >= d.ngShare ? "#2bb3a3" : "#e8b34b" }} /></i><b>{pct}%</b></div>;
          })}
        </div>
        <div className="exc-card">
          <h2>Quota setting</h2>
          <p className="exh-quota">{d.ngShare}% NIGERIA</p>
          <p className="exh-rest">{100 - d.ngShare}% rest of the world</p>
          <p className="epf-hint">Applied to each team every hiring round. Only the CEO can change it. Face check before a change <span className="exl-soon">Soon</span></p>
          {d.canQuota && <button type="button" className="exa-ghost" onClick={() => setQuota(d.ngShare)}>Change the quota</button>}
        </div>
      </div>

      <div className="exc-row exn-row">
        <div className="exc-card">
          <h2>Pipeline</h2>
          <div className="exn-table" role="table" aria-label="Pipeline">
            <div className="exn-th exh-g" role="row"><span>Stage</span><span>Nigeria</span><span>World</span></div>
            {d.pipeline.map((p) => <div key={p.stage} className="exn-tr exh-g" role="row"><span>{STAGE[p.stage] ?? p.stage}</span><span>{p.ng.toLocaleString("en-US")}</span><span>{p.world.toLocaleString("en-US")}</span></div>)}
          </div>
          <p className="epf-hint">Nigerian citizens abroad count as Nigeria. Move applicants on the <Link href="/careers/desk">hiring desk</Link>.</p>
        </div>
        <div className="exc-card">
          <h2>Applications by country</h2>
          {dest.length === 0 && <p className="exc-empty">No applications this quarter.</p>}
          {dest.map(([c, n]) => <div key={c} className="exf-sig exh-bar"><span>{countryName(c)}</span><i><em style={{ width: `${(n / maxC) * 100}%`, background: c === "NG" ? "#2bb3a3" : "#8b7cf6" }} /></i><b>{n.toLocaleString("en-US")}</b></div>)}
        </div>
      </div>

      {quota !== null && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-label="Change the quota" onClick={(e) => e.target === e.currentTarget && setQuota(null)}>
          <div className="exa-dialog">
            <h2>Change the quota</h2>
            <label className="epf-f"><span>Share of roles kept for Nigeria: {quota}%</span><input type="range" min={0} max={100} step={5} value={quota} onChange={(e) => setQuota(Number(e.target.value))} /></label>
            <p className="epf-hint">{100 - quota}% of roles open to the world. Applied from the next hiring round.</p>
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setQuota(null)}>Cancel</button><button type="button" className="exa-red" disabled={busy || quota === d.ngShare} onClick={saveQuota}>{busy ? "Saving…" : "Save quota"}</button></div>
          </div>
        </div>
      )}
      {post && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-label="Post a role" onClick={(e) => e.target === e.currentTarget && setPost(null)}>
          <form className="exa-dialog exh-dialog" onSubmit={savePost}>
            <h2>Post a role</h2>
            <div className="epf-two">
              <label className="epf-f"><span>Title</span><input required maxLength={120} value={post.title} onChange={set("title")} placeholder="Go engineer" /></label>
              <label className="epf-f"><span>Team</span><input required maxLength={40} value={post.team} onChange={set("team")} placeholder="Platform" /></label>
              <label className="epf-f"><span>City</span><input required maxLength={80} value={post.city} onChange={set("city")} placeholder="Lagos" /></label>
              <label className="epf-f"><span>Country</span><select value={post.country} onChange={set("country")}>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
              <label className="epf-f"><span>Type</span><select value={post.kind} onChange={set("kind")}>{Object.entries(KIND).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label className="epf-f"><span>Who can apply</span><select value={post.quota} onChange={set("quota")}><option value="ng">Kept for Nigeria</option><option value="world">Open worldwide</option></select></label>
              <label className="epf-f"><span>Pay (optional)</span><input maxLength={80} value={post.pay} onChange={set("pay")} placeholder="₦18M to ₦26M a year" /></label>
              <label className="epf-f"><span>Setup (optional)</span><input maxLength={40} value={post.setup} onChange={set("setup")} placeholder="Hybrid" /></label>
            </div>
            <label className="epf-f"><span>What you will do</span><textarea required rows={3} maxLength={2000} value={post.about} onChange={set("about")} /></label>
            <label className="epf-f"><span>What you bring</span><textarea required rows={3} maxLength={2000} value={post.bring} onChange={set("bring")} /></label>
            <label className="epf-tog"><span>Remote allowed</span><input type="checkbox" role="switch" checked={post.remote} onChange={set("remote")} /></label>
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setPost(null)}>Cancel</button><button type="submit" className="exa-red" disabled={busy}>{busy ? "Posting…" : "Post role"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}
