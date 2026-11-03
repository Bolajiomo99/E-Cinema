"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Milestone } from "@/lib/exec";

// Investor view (Figma 50:609). Amounts are US cents at today's rate. Numbers we cannot back with
// data yet (retention, LTV to CAC, runway, running costs) say Soon instead of a guess.
export type InvestorView = {
  net30: number; netPrev30: number; gross30: number; studio30: number; buyers30: number; members: number; paying: number; planValue: number;
  months: { label: string; name: string; usd: number }[]; milestones: Milestone[]; canEdit: boolean; viewer: string; missing: string[];
};

const big = (c: number) => { const v = c / 100; return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `$${Math.round(v / 1e3)}K` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; };
const cents = (c: number) => `$${(c / 100).toFixed(2)}`;
const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString("en-US"));
const SOON = <small className="exsec-soon">Soon</small>;

export default function ExecInvestor({ v }: { v: InvestorView }) {
  const router = useRouter();
  const [add, setAdd] = useState({ quarter: "", title: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const run = Math.round((v.net30 * 365) / 30);
  const yoy = v.netPrev30 ? Math.round(((v.net30 - v.netPrev30) / v.netPrev30) * 100) : null;
  const peak = Math.max(1, ...v.months.map((m) => m.usd));
  const per = (c: number) => (v.buyers30 ? cents(c / v.buyers30) : "–");
  const margin = v.gross30 - v.studio30;

  async function save(m: Partial<Milestone>) {
    setBusy(true); setErr("");
    const r = await fetch("/api/executive/milestones", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(m) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not save"); return false; }
    router.refresh();
    return true;
  }
  async function remove(id: number) {
    setBusy(true);
    await fetch(`/api/executive/milestones/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(false); router.refresh();
  }

  return (
    <section className="exc exinv">
      {v.viewer && <div className="exinv-wm" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <span key={i}>{v.viewer}</span>)}</div>}
      <header className="exc-head">
        <div>
          <h1>E-Cinema for investors</h1>
          <p className="exc-sub">Updated live. Figures are aggregated; no personal data. Exports carry your name as a watermark.</p>
        </div>
        <div className="epf-acts exinv-noprint">
          <button type="button" className="exa-ghost" onClick={() => window.print()}>Download board pack (PDF)</button>
        </div>
      </header>

      <div className="exc-tiles exin-tiles">
        <div className="exc-tile"><span>Annual run rate</span><b>{big(run)}</b><small className={yoy !== null && yoy < 0 ? "down" : "up"}>{yoy === null ? "net, last 30 days × 12" : `${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy)}% year on year`}</small></div>
        <div className="exc-tile"><span>Members</span><b>{count(v.members)}</b><small className="up">{count(v.paying)} on a paid plan</small></div>
        <div className="exc-tile"><span>Net revenue retention</span><b className="exin-soon">Soon</b><small>needs a full year of plans</small></div>
        <div className="exc-tile"><span>LTV : CAC</span><b className="exin-soon">Soon</b><small>needs marketing spend</small></div>
        <div className="exc-tile"><span>Runway</span><b className="exin-soon">Soon</b><small>needs the bank balance</small></div>
      </div>

      <div className="exc-row exinv-row">
        <div className="exc-card">
          <h2>Monthly net revenue (USD)</h2>
          <div className="exinv-bars" role="img" aria-label={v.months.map((m) => `${m.name} ${big(m.usd)}`).join(", ")}>
            {v.months.map((m, i) => (
              <div key={m.name} className="exinv-col" title={`${m.name}: ${big(m.usd)}`}>
                <em style={{ height: `${Math.max(m.usd ? 3 : 0, (m.usd / peak) * 100)}%`, opacity: 0.45 + (0.55 * (i + 1)) / v.months.length }} />
                <span>{m.label}</span>
              </div>
            ))}
          </div>
          <p className="epf-hint">E-Cinema&apos;s share after the studios&apos; 70% of tickets. Paid plans are not in this chart yet.{v.missing.length ? ` No rate today for ${v.missing.join(", ")}.` : ""}</p>
        </div>
        <div className="exc-card">
          <h2>Unit economics per paying member</h2>
          <div className="exin-kv"><span>Average spend, last 30 days</span><b>{per(v.gross30)}</b></div>
          <div className="exin-kv"><span>Content cost (studio share)</span><b>{per(v.studio30)}</b></div>
          <div className="exin-kv"><span>Streaming and AI cost</span>{SOON}</div>
          <div className="exin-kv"><span>Payment fees</span>{SOON}</div>
          <div className="exin-kv exinv-total"><span>Margin after studio share</span><b>{per(margin)}{v.gross30 ? ` · ${Math.round((margin / v.gross30) * 100)}%` : ""}</b></div>
          <p className="epf-hint">Per account that paid for anything in the last 30 days ({v.buyers30.toLocaleString("en-US")}). Paid plans at list price: {big(v.planValue)} a month (VIP counted at one seat).</p>
        </div>
      </div>

      <div className="exc-row exinv-row">
        <div className="exc-card">
          <h2>Milestones</h2>
          {v.milestones.length === 0 && <p className="exc-empty">{v.canEdit ? "No milestones posted yet. Add the first one below." : "The CEO has not posted milestones yet."}</p>}
          {v.milestones.map((m) => (
            <div key={m.id} className={`exinv-ms ${m.done ? "done" : ""}`}>
              <b>{m.quarter}</b><span>{m.title}</span>
              {m.done && <i className="exsec-pill ok">Done</i>}
              {v.canEdit && (
                <span className="exinv-noprint exinv-msa">
                  <button type="button" className="exsec-link" disabled={busy} onClick={() => save({ ...m, done: !m.done })}>{m.done ? "Not done" : "Mark done"}</button>
                  <button type="button" className="exsec-link" disabled={busy} onClick={() => remove(m.id)}>Remove</button>
                </span>
              )}
            </div>
          ))}
          {v.canEdit && (
            <form className="exinv-add exinv-noprint" onSubmit={async (e) => { e.preventDefault(); if (await save({ id: 0, quarter: add.quarter, title: add.title, done: false })) setAdd({ quarter: "", title: "" }); }}>
              <input aria-label="Quarter" required placeholder="Q1 2027" pattern="[Qq][1-4] 20[0-9]{2}" value={add.quarter} onChange={(e) => setAdd({ ...add, quarter: e.target.value })} />
              <input aria-label="Milestone" required minLength={3} maxLength={140} placeholder="What will be true by then" value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} />
              <button type="submit" className="exa-red" disabled={busy}>Add</button>
            </form>
          )}
          {err && <p className="epf-err" role="alert">{err}</p>}
        </div>
        <div className="exc-card">
          <h2>Cap table summary</h2>
          <div className="exlc-donut">
            <svg viewBox="0 0 140 140" role="img" aria-label="Founder 100%">
              <circle cx="70" cy="70" r="56" fill="none" stroke="#e3182d" strokeWidth="18" />
            </svg>
            <ul><li><i style={{ background: "#e3182d" }} />Founder<b>100%</b></li></ul>
          </div>
          <p className="epf-hint">Online Cinema Ltd (RC 9947766), from the CAC status report. This updates when new shares are issued.</p>
        </div>
      </div>
    </section>
  );
}
