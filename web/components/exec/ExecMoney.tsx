"use client";
import Link from "next/link";
import { useState } from "react";
import { countryName } from "@/lib/worldmap";

// Money (Figma 50:253). Everything converted to US dollars at today's rate; the original
// currencies are one tap away. Figures with no source yet carry "Soon".
export type MoneyView = {
  days: number; gross: number; grossPrev: number; net: number; netPrev: number; refunds: [number, number, number, number];
  sources: { key: string; label: string; net: number }[];
  regions: { region: string; net: number }[];
  providers: { key: string; volume: number; paid: number; tried: number; refunded: number; countries: string[] }[];
  out: { label: string; usd: number }[];
  original: { currency: string; minor: number }[];
  missing: string[];
};
const COLORS = ["#e3182d", "#8b7cf6", "#d4a23a", "#2bb3a3", "#4696ff", "#ff8c28", "#6e6e7a"];
const NAME: Record<string, string> = { paystack: "Paystack", flutterwave: "Flutterwave", paypal: "PayPal", cash: "Cash on delivery" };
function usd(c: number) {
  const v = c / 100;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `$${Math.round(v / 1e3)}k`;
  const cents = Math.abs(v) < 100 && !Number.isInteger(v);
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
function delta(now: number, before: number) {
  if (!before) return now ? { t: "new", up: true } : null;
  const p = Math.round(((now - before) / before) * 100);
  return { t: `${Math.abs(p)}%`, up: p >= 0 };
}

export default function ExecMoney({ v }: { v: MoneyView }) {
  const [orig, setOrig] = useState(false);
  const refundNow = pct(v.refunds[0], v.refunds[1]), refundBefore = pct(v.refunds[2], v.refunds[3]);
  const rd = Math.round((refundNow - refundBefore) * 10) / 10;
  const g = delta(v.gross, v.grossPrev), n = delta(v.net, v.netPrev);
  const total = v.sources.reduce((s, x) => s + x.net, 0);
  const maxR = Math.max(1, ...v.regions.map((r) => r.net));
  const period = v.days === 30 ? "30 days" : v.days === 90 ? "quarter" : "year";

  // The board pack: the page's numbers as a spreadsheet file.
  function exportPack() {
    const rows: (string | number)[][] = [["E-Cinema money", `last ${v.days} days`, "USD at today's rate"], [], ["Gross bookings", (v.gross / 100).toFixed(2)], ["Net revenue", (v.net / 100).toFixed(2)], ["Refund rate %", refundNow], [], ["Source", "Net USD"]];
    v.sources.forEach((s) => rows.push([s.label, (s.net / 100).toFixed(2)]));
    rows.push([], ["Region", "Net USD"]);
    v.regions.forEach((r) => rows.push([r.region, (r.net / 100).toFixed(2)]));
    rows.push([], ["Provider", "Volume USD", "Checkouts", "Paid", "Refunded"]);
    v.providers.forEach((p) => rows.push([NAME[p.key], (p.volume / 100).toFixed(2), p.tried, p.paid, p.refunded]));
    rows.push([], ["Money out this month", "USD"]);
    v.out.forEach((o) => rows.push([o.label, (o.usd / 100).toFixed(2)]));
    rows.push([], ["Currency", "Gross (original)"]);
    v.original.forEach((o) => rows.push([o.currency, (o.minor / 100).toFixed(2)]));
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `e-cinema-money-${v.days}d.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Donut segments: each starts where the ones before it end.
  const C = 2 * Math.PI * 38;
  const arcs = v.sources.map((s, i) => ({ s, i, len: total ? (s.net / total) * C : 0, start: total ? (v.sources.slice(0, i).reduce((a, x) => a + x.net, 0) / total) * C : 0 }));
  return (
    <section className="exc exm">
      <header className="exc-head">
        <div>
          <h1>Money</h1>
          <p className="exc-sub">All currencies converted to USD at today&apos;s mid-market rate. <button className="exm-link" onClick={() => setOrig(!orig)} aria-expanded={orig}>{orig ? "Hide original currencies" : "Original currency"}</button></p>
        </div>
        <div className="exc-chips" role="group" aria-label="Period">
          {[[30, "30 days"], [90, "Quarter"], [365, "Year"]].map(([d, t]) => <Link key={d} href={`/executive/money?days=${d}`} className={`exm-chip${v.days === d ? " on" : ""}`} aria-current={v.days === d ? "page" : undefined}>{t}</Link>)}
          <button className="exm-export" onClick={exportPack}>Export board pack</button>
        </div>
      </header>
      {orig && (
        <div className="exc-card exm-orig">
          {v.original.length ? v.original.map((o) => <span key={o.currency}><b>{o.currency}</b> {(o.minor / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>) : <span>No bookings in this {period}.</span>}
        </div>
      )}
      {v.missing.length > 0 && <p className="exa-msg bad">No exchange rate for {v.missing.join(", ")} right now, so those amounts are left out of the dollar totals.</p>}

      <div className="exc-tiles">
        <div className="exc-tile"><span>Gross bookings</span><b>{usd(v.gross)}</b><small className={g ? (g.up ? "up" : "down") : ""}>{g ? `${g.up ? "▲" : "▼"} ${g.t}` : `last ${period}`}</small></div>
        <div className="exc-tile"><span>Net revenue</span><b>{usd(v.net)}</b><small className={n ? (n.up ? "up" : "down") : ""}>{n ? `${n.up ? "▲" : "▼"} ${n.t}` : "after studios' 70%"}</small></div>
        <div className="exc-tile soon"><span>Gross margin<em className="soon-tag">Soon</em></span><small>Needs cost data (cloud, AI, fees)</small></div>
        <div className="exc-tile soon"><span>Cash in bank<em className="soon-tag">Soon</em></span><small>Needs the bank feed</small></div>
        <div className="exc-tile"><span>Refunds</span><b>{refundNow}%</b><small className={rd > 0 ? "down" : rd < 0 ? "up" : ""}>{rd ? `${rd > 0 ? "▲" : "▼"} ${Math.abs(rd)} pts` : `${v.refunds[0]} of ${v.refunds[1]} seats`}</small></div>
      </div>

      <div className="exc-row exm-row">
        <div className="exc-card">
          <h2>Revenue by source</h2>
          {total > 0 ? (
            <div className="exm-donut">
              <svg viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="Net revenue by source">
                {arcs.map(({ s, i, len, start }) => <circle key={s.key} cx="50" cy="50" r="38" fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-start} transform="rotate(-90 50 50)" />)}
              </svg>
              <ul>
                {v.sources.map((s, i) => <li key={s.key}><i style={{ background: COLORS[i % COLORS.length] }} />{s.label} · {Math.round((s.net / total) * 100)}%</li>)}
                <li className="off"><i />Plans and subscriptions<em className="soon-tag">Soon</em></li>
              </ul>
            </div>
          ) : <p className="exc-empty">No revenue in this {period} yet.</p>}
        </div>
        <div className="exc-card">
          <h2>Net revenue by region (USD)</h2>
          {v.regions.length ? (
            <div className="exm-bars" role="list">
              {v.regions.slice(0, 8).map((r, i) => (
                <div key={r.region} role="listitem" aria-label={`${r.region} ${usd(r.net)}`}>
                  <small>{usd(r.net)}</small>
                  <i style={{ height: `${Math.max(4, (r.net / maxR) * 120)}px`, background: i === 0 ? "#8b7cf6" : "#5b51a6" }} />
                  <span>{r.region}</span>
                </div>
              ))}
            </div>
          ) : <p className="exc-empty">No revenue in this {period} yet.</p>}
        </div>
      </div>

      <div className="exc-row exm-row2">
        <div className="exc-card">
          <h2>Payment providers</h2>
          <div className="exm-table" role="table" aria-label="Payment providers">
            <div className="exm-th" role="row"><span role="columnheader">Provider</span><span role="columnheader">Buyer countries</span><span role="columnheader">Volume</span><span role="columnheader">Success</span><span role="columnheader">Refunded</span></div>
            {v.providers.map((p) => (
              <div key={p.key} className="exm-tr" role="row">
                <span role="cell">{NAME[p.key]}</span>
                <span role="cell">{p.countries.length ? (p.countries.length > 4 ? `${p.countries.length} countries` : p.countries.map((c) => countryName(c, true)).join(", ")) : "–"}</span>
                <span role="cell">{usd(p.volume)}</span>
                <span role="cell">{p.tried ? `${pct(p.paid, p.tried)}%` : "–"}</span>
                <span role="cell">{p.paid ? `${pct(p.refunded, p.paid)}%` : "–"}</span>
              </div>
            ))}
            {["Stripe", "Razorpay", "Crypto"].map((k) => <div key={k} className="exm-tr off" role="row"><span role="cell">{k}<em className="soon-tag">Soon</em></span><span role="cell">Not connected yet</span><span role="cell" /><span role="cell" /><span role="cell" /></div>)}
          </div>
          <p className="exm-note">Success counts seat checkouts that reached the provider and were paid.</p>
        </div>
        <div className="exc-card exm-out">
          <h2>Money out this month</h2>
          {v.out.map((o) => <div key={o.label}><span>{o.label}</span><b>{usd(o.usd)}</b></div>)}
          {["Cloud and CDN", "AI compute (dubbing, moderation)", "Payment fees", "Marketing", "Payroll"].map((k) => <div key={k} className="off"><span>{k}</span><em className="soon-tag">Soon</em></div>)}
        </div>
      </div>
    </section>
  );
}
