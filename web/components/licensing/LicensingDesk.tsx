"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { dateName, naira, PLANS, type Application, type Case, type Check, type Product } from "@/lib/licensing-types";
import { countryName } from "@/lib/worldmap";
import { pcall } from "./pcall";

type App = Application & { doc?: string; photoLinks?: string[] };
const CHECK: Record<Check["result"], string> = { pass: "teal", fail: "red", needed: "amber" };

export default function LicensingDesk() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(() => pcall<{ applications: App[]; products: Product[] }>("GET", "desk").then((r) => {
    setApps(r.applications);
    setProducts(r.products);
  }, (e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="bp-desk">
      <h1>Licensing desk</h1>
      <p className="bp-lead">{apps ? `${apps.length} application${apps.length === 1 ? "" : "s"} and ${products.length} product${products.length === 1 ? "" : "s"} waiting.` : "Loading"} Approved partners pay their fee, then start selling.</p>
      {err && <p className="vf-err" role="alert">{err}</p>}
      <h2>Applications</h2>
      {apps?.length === 0 && <p className="bp-none">No applications waiting.</p>}
      {apps?.map((a) => <AppRow key={a.id} a={a} onDone={load} />)}
      <h2>Products</h2>
      {apps && products.length === 0 && <p className="bp-none">No designs waiting.</p>}
      {products.map((p) => <ProductRow key={p.id} p={p} onDone={load} />)}
      <h2>Compliance cases</h2>
      <Cases />
      <h2>Royalties</h2>
      <Settle />
    </div>
  );
}

function AppRow({ a, onDone }: { a: App; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [fee, setFee] = useState(a.feeNgn || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const plan = PLANS.find((p) => p.id === a.plan);
  async function review(approve: boolean) {
    setBusy(true); setErr("");
    try { await pcall("POST", `desk/applications/${a.id}`, { approve, note, feeNgn: fee }); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <article className="bp-desk-row">
      <header><b>{a.company} · {a.regNumber}</b><span className="bp-pill purple">{plan?.name}</span></header>
      <p className="bp-meta">
        {[a.city, countryName(a.country)].filter(Boolean).join(", ")}{a.website && ` · ${a.website}`} · sells in {a.countries.map((c) => countryName(c)).join(", ")} · sent {dateName(a.createdAt)}
        <br />Makes: {a.products || "not said"} · applicant {a.applicant}
      </p>
      <p className={a.docOk ? "bp-meta" : "bp-ai-line"}>{a.docKey ? <>Certificate: {a.docNote} {a.doc && <a href={a.doc} target="_blank" rel="noreferrer">Open</a>}</> : "No certificate uploaded"}</p>
      {!!a.photoLinks?.length && <div className="bp-desk-ph">{a.photoLinks.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Workshop photo ${i + 1}`} /></a>)}</div>}
      <div className="bp-desk-act">
        {plan && !plan.feeNgn && <label>Agreed fee ₦ <input type="number" min={100000} step={50000} value={fee} onChange={(e) => setFee(Number(e.target.value))} /></label>}
        <label className="grow">Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to fix, or a welcome note" maxLength={300} /></label>
        <button className="vf-btn red sm" disabled={busy} onClick={() => review(true)}>Approve{plan?.feeNgn ? ` · ${naira(plan.feeNgn)}` : ""}</button>
        <button className="vf-btn ghost sm" disabled={busy} onClick={() => review(false)}>Ask for changes</button>
      </div>
      {err && <p className="vf-err" role="alert">{err}</p>}
    </article>
  );
}

function ProductRow({ p, onDone }: { p: Product; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function decide(status: string) {
    setBusy(true); setErr("");
    try { await pcall("POST", `desk/products/${p.id}`, { status, note }); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <article className="bp-desk-row">
      <header><b>{p.name}{p.detail ? ` · ${p.detail}` : ""}</b><span className="bp-pill grey">{p.partner} · {p.licence}</span></header>
      <p className="bp-meta">{naira(p.priceNgn)}{p.film ? ` · ${p.film} artwork` : " · logo only"} · sent {dateName(p.createdAt)}</p>
      <div className="bp-desk-ph">
        {p.image && <a href={p.image} target="_blank" rel="noreferrer"><img src={p.image} alt="Design" /></a>}
        {p.sample && <a href={p.sample} target="_blank" rel="noreferrer"><img src={p.sample} alt="Printed sample" /></a>}
      </div>
      <div className="dk-checks">{p.checks.map((c) => <span key={c.name} className={`bp-pill ${CHECK[c.result]}`} title={c.detail}>{c.name}: {c.detail}</span>)}</div>
      <div className="bp-desk-act">
        <label className="grow">Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Needed for changes or a rejection" maxLength={300} /></label>
        <button className="vf-btn red sm" disabled={busy} onClick={() => decide("live")}>Approve</button>
        <button className="vf-btn ghost sm" disabled={busy} onClick={() => decide("changes")}>Ask for changes</button>
        <button className="vf-btn ghost sm danger" disabled={busy} onClick={() => decide("rejected")}>Reject</button>
      </div>
      {err && <p className="vf-err" role="alert">{err}</p>}
    </article>
  );
}

function Settle() {
  const [licence, setLicence] = useState("");
  const [month, setMonth] = useState(() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="bp-desk-row" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setMsg("");
      try { await pcall("POST", `desk/settle/${licence.trim().toUpperCase()}`, { month }); setMsg(`${licence.toUpperCase()} ${month} marked settled.`); } catch (x) { setMsg((x as Error).message); } finally { setBusy(false); }
    }}>
      <p className="bp-meta">When a partner&apos;s royalty for a month is paid and their shop sales are paid out, mark the statement settled.</p>
      <div className="bp-desk-act">
        <label>Licence <input required value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="NG-0042" pattern="[A-Za-z]{2}-\d{4}" /></label>
        <label>Month <input required type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <button className="vf-btn red sm" disabled={busy}>Mark settled</button>
      </div>
      {msg && <p className="bp-meta" role="status">{msg}</p>}
    </form>
  );
}

// Market-check findings (email 43): open a case, then close it once fixed or suspend the licence.
function Cases() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [f, setF] = useState({ licence: "", issue: "", place: "", finding: "", days: 14 });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => pcall<{ cases: Case[] }>("GET", "desk/cases").then((r) => setCases(r.cases), (e: Error) => setMsg(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const decide = async (c: Case, outcome: "closed" | "suspended") => {
    if (outcome === "suspended" && !confirm(`Suspend licence ${c.licence}? The partner can no longer sell until it is restored.`)) return;
    setBusy(true); setMsg("");
    try { await pcall("POST", `desk/cases/${c.id}/decide`, { outcome }); setMsg(`${c.number} ${outcome === "closed" ? "closed" : "closed and licence suspended"}.`); load(); } catch (x) { setMsg((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {cases?.length === 0 && <p className="bp-none">No open cases.</p>}
      {cases?.map((c) => {
        const late = c.status === "open" && c.fixBy < new Date().toISOString().slice(0, 10);
        return (
          <article key={c.id} className="bp-desk-row">
            <p className="bp-meta"><b>{c.number}</b> · {c.company} ({c.licence}) · {c.issue}{c.place ? ` in ${c.place}` : ""} · fix by {dateName(c.fixBy)}{late ? " · overdue" : ""}</p>
            <p className="bp-meta">{c.finding}</p>
            {c.status === "fixed" && <p className="bp-meta">Partner says fixed: {c.partnerNote}</p>}
            <div className="bp-desk-act">
              <button className="vf-btn soft sm" disabled={busy} onClick={() => decide(c, "closed")}>Close case</button>
              <button className="vf-btn red sm" disabled={busy} onClick={() => decide(c, "suspended")}>Suspend licence</button>
            </div>
          </article>
        );
      })}
      <form className="bp-desk-row" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setMsg("");
        try {
          const c = await pcall<Case>("POST", `desk/cases/${f.licence.trim().toUpperCase()}`, f);
          setMsg(`${c.number} opened. ${c.company} has been emailed.`);
          setF({ licence: "", issue: "", place: "", finding: "", days: 14 });
          load();
        } catch (x) { setMsg((x as Error).message); } finally { setBusy(false); }
      }}>
        <p className="bp-meta">Open a case when a market check finds a partner breaking the rules. They get a warning email and the days you give to fix it.</p>
        <div className="bp-desk-act">
          <label>Licence <input required value={f.licence} onChange={(e) => setF({ ...f, licence: e.target.value })} placeholder="NG-0057" pattern="[A-Za-z]{2}-\d{4}" /></label>
          <label>What was found <input required maxLength={80} className="wide" value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} placeholder="unlabelled caps" /></label>
          <label>Where <input maxLength={60} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="Kano" /></label>
          <label>Days to fix <input required type="number" min={1} max={60} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} /></label>
        </div>
        <label className="bp-desk-note">Details and what to do <textarea required maxLength={600} rows={3} value={f.finding} onChange={(e) => setF({ ...f, finding: e.target.value })} placeholder="Our investigator bought 6 caps at your Kano stall with no authenticity label. Label or withdraw all stock." /></label>
        <div className="bp-desk-act"><button className="vf-btn red sm" disabled={busy}>Open case and email partner</button></div>
        {msg && <p className="bp-meta" role="status">{msg}</p>}
      </form>
    </>
  );
}
