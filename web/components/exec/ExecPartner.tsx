"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Deal, PartnerData } from "@/lib/exec";
import { countryName } from "@/lib/worldmap";

// Partners view (Figma 51:198). Each partner sees only their own deal. Payment partners see the
// seat payments that went through them; carrier billing has no integration yet.
const KIND: Record<string, string> = { payments: "Payment partner", carrier: "Mobile carrier", other: "Partner" };
const PROVIDER: Record<string, string> = { paypal: "PayPal", paystack: "Paystack", flutterwave: "Flutterwave" };
const SYM: Record<string, string> = { NGN: "₦", USD: "$", EUR: "€", GBP: "£" };
const money = (minor: number, cur: string) => { const v = minor / 100; const s = v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString("en-US", { maximumFractionDigits: 0 }); return `${SYM[cur] ?? `${cur} `}${s}`; };

export default function ExecPartner({ d, as }: { d: PartnerData; as: string }) {
  const router = useRouter();
  const [edit, setEdit] = useState<(Deal & { planText: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const deal = d.deal;
  const s = d.stats;
  const growth = s && s.paidPrev ? Math.round(((s.paid - s.paidPrev) / s.paidPrev) * 100) : null;
  const spots = s ? Object.entries(s.countries).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const peak = Math.max(1, ...spots.map((x) => x[1]));
  const picked = d.deals.find((x) => x.email === as);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/executive/partner", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...edit, plan: edit.planText.split("\n") }) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r?.ok) { setErr(b.error ?? "Could not save"); return; }
    setEdit(null); router.refresh();
  }

  return (
    <section className="exc exinv">
      <header className="exc-head">
        <div>
          <h1>{deal ? `Your partnership with E-Cinema` : "Partners view"}</h1>
          <p className="exc-sub">{deal ? `${deal.org || deal.name} · ${deal.summary || KIND[deal.kind]}. You only see your own deal.` : d.canEdit ? "Pick a partner to set up their deal and see exactly what they see." : "Your deal is being set up. Your numbers will show here once it is ready."}</p>
        </div>
        {deal && <div className="epf-acts exinv-noprint"><button type="button" className="exa-ghost" onClick={() => window.print()}>Download monthly report</button></div>}
      </header>

      {d.canEdit && (
        <div className="exc-card exinv-noprint exprt-pick">
          <h2>Partners</h2>
          {d.deals.length === 0 && <p className="exc-empty">No partners yet. Add someone with the Partner role on <Link href="/executive/access">Access and roles</Link>.</p>}
          <div className="exprt-chips">
            {d.deals.map((x) => (
              <Link key={x.email} href={`/executive/partners?as=${encodeURIComponent(x.email)}`} className={`exprt-chip ${x.email === as ? "on" : ""}`}>{x.org || x.name || x.email}{!x.kind && " · not set up"}</Link>
            ))}
          </div>
          {picked && <button type="button" className="exa-ghost" onClick={() => setEdit({ ...picked, kind: picked.kind || "payments", provider: picked.provider || (picked.kind ? "" : "paystack"), planText: picked.plan.join("\n") })}>{picked.kind ? "Edit their deal" : "Set up their deal"}</button>}
        </div>
      )}

      {deal?.kind === "payments" && s && (
        <>
          <div className="exc-tiles exg-tiles">
            <div className="exc-tile"><span>Seat payments through {PROVIDER[deal.provider]}</span><b>{s.paid.toLocaleString("en-US")}</b><small className={growth !== null && growth < 0 ? "down" : "up"}>{growth === null ? "this month" : `${growth >= 0 ? "▲" : "▼"} ${Math.abs(growth)}% on last month`}</small></div>
            <div className="exc-tile"><span>Success rate</span><b>{s.tried ? `${Math.round((s.paid / s.tried) * 100)}%` : "–"}</b><small>{s.tried.toLocaleString("en-US")} checkouts this month</small></div>
            <div className="exc-tile"><span>Volume this month</span><b>{s.volume.length ? money(s.volume[0].minor, s.volume[0].currency) : "–"}</b><small>{s.volume.slice(1).map((v) => money(v.minor, v.currency)).join(" · ") || "what buyers paid"}</small></div>
            <div className="exc-tile"><span>Refunds</span><b>{s.refunded}</b><small>{s.paid ? `${Math.round((s.refunded / s.paid) * 100)}% of payments` : "this month"}</small></div>
          </div>
          <div className="exc-row exinv-row">
            <div className="exc-card">
              <h2>Seats paid by country</h2>
              {spots.length === 0 && <p className="exc-empty">No payments yet this month.</p>}
              {spots.map(([cc, n]) => <div key={cc} className="exf-sig exh-bar"><span>{cc === "??" ? "Not given" : countryName(cc)}</span><i><em style={{ width: `${(n / peak) * 100}%`, background: "#d9a838" }} /></i><b>{n.toLocaleString("en-US")}</b></div>)}
            </div>
            <Plan deal={deal} />
          </div>
        </>
      )}
      {deal && deal.kind !== "payments" && (
        <div className="exc-row exinv-row">
          <div className="exc-card">
            <h2>Your numbers</h2>
            {deal.kind === "carrier" ? <p className="exc-sub">Bundles and pay-with-airtime numbers arrive once carrier billing is connected. <small className="exsec-soon">Soon</small></p> : <p className="exc-sub">Numbers for this deal are shared in the monthly report.</p>}
          </div>
          <Plan deal={deal} />
        </div>
      )}

      <div className="exc-card">
        <h2>Other partner types see their own view</h2>
        <div className="exprt-types">
          <div><b>Payment partners</b><small>Volume, success rate, refunds</small></div>
          <Link href="/studio"><b>Studios and distributors</b><small>Their films only (Studio portal)</small></Link>
          <Link href="/partner"><b>Merch makers</b><small>Orders, stock, returns, payouts</small></Link>
          <Link href="/executive/stakeholder"><b>Stakeholders</b><small>Monthly summary and what you choose to share</small></Link>
        </div>
      </div>

      {edit && (
        <div className="exa-scrim" role="dialog" aria-modal="true" aria-label="Partner deal" onClick={(e) => e.target === e.currentTarget && setEdit(null)}>
          <form className="exa-dialog" onSubmit={save}>
            <h2>{edit.org || edit.name || edit.email}</h2>
            <div className="epf-two">
              <label className="epf-f"><span>Kind</span><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KIND).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              {edit.kind === "payments" && <label className="epf-f"><span>Provider</span><select value={edit.provider} onChange={(e) => setEdit({ ...edit, provider: e.target.value })}><option value="">Choose</option>{Object.entries(PROVIDER).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>}
            </div>
            <label className="epf-f"><span>One line on the deal</span><input maxLength={200} value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} placeholder="Card and bank payments in Nigeria" /></label>
            <label className="epf-f"><span>Shared plan (one item per line, up to 8)</span><textarea rows={5} value={edit.planText} onChange={(e) => setEdit({ ...edit, planText: e.target.value })} /></label>
            {err && <p className="epf-err" role="alert">{err}</p>}
            <div className="epf-acts"><button type="button" className="exa-ghost" onClick={() => setEdit(null)}>Cancel</button><button type="submit" className="exa-red" disabled={busy}>{busy ? "Saving…" : "Save deal"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}

function Plan({ deal }: { deal: Deal }) {
  return (
    <div className="exc-card">
      <h2>Shared plan</h2>
      {deal.plan.length === 0 ? <p className="exc-empty">No shared plan yet.</p> : deal.plan.map((p) => <div key={p} className="exin-chk"><span className="y" style={{ color: "#d9a838" }}>✓</span>{p}</div>)}
    </div>
  );
}
