"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Analytics } from "@/lib/licensing-types";
import { countryName } from "@/lib/worldmap";
import { pcall, saveCsv } from "./pcall";

// "Export CSV" on the analytics page: the breakdowns on screen, as a spreadsheet.
export function AnalyticsExport({ a, label }: { a: Analytics; label: string }) {
  return (
    <button className="vf-btn soft" onClick={() => saveCsv(`e-cinema-sales-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["E-Cinema sales", label],
      ["Average order (NGN)", a.avgOrderNgn], ["Orders", a.orders], ["Repeat buyers %", a.repeatPct], ["Premiere-night lift", a.premiereLift], ["Returns %", a.returnsPct],
      [], ["Country", "Sales (NGN)", "Share %"], ...a.byCountry.map((r) => [countryName(r.name), r.value, r.pct]),
      [], [`City (${countryName(a.cityCountry)})`, "Sales (NGN)", "Share %"], ...a.byCity.map((r) => [r.name, r.value, r.pct]),
      [], ["Film", "Sales (NGN)", "Share %"], ...a.byFilm.map((r) => [r.name, r.value, r.pct]),
      [], ["Hour (Lagos)", "Units on premiere nights"], ...a.premiereHours.map((n, h) => [`${String(h).padStart(2, "0")}:00`, n]),
    ])}>Export CSV</button>
  );
}

// Partners record their own shop, stall and wholesale sales here, one at a time or from a
// spreadsheet. E-Cinema shop sales arrive on their own.
const HEAD = "product,channel,country,city,qty,amount_ngn,film,date,buyer,ref";
export function RecordSales({ products, countries }: { products: string[]; countries: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ product: products[0] ?? "", channel: "own", country: countries[0] ?? "NG", city: "", qty: "1", amount: "", film: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function send(sales: Record<string, unknown>[]) {
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await pcall<{ added: number }>("POST", "partner/sales", { sales });
      setMsg(`${r.added} sale${r.added === 1 ? "" : "s"} added.`);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function fromFile(file?: File) {
    if (!file) return;
    const rows = (await file.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rows[0]?.toLowerCase().startsWith("product")) rows.shift();
    const split = (l: string) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim());
    await send(rows.slice(0, 2000).map((l) => {
      const [product, channel, country, city, qty, amount, film, date, buyer, ref] = split(l);
      return { product, channel: channel || "own", country: country || countries[0], city, qty: Number(qty) || 1, amountNgn: Math.round(Number((amount || "0").replace(/[^\d.]/g, ""))), film, soldAt: date ? new Date(date).toISOString() : undefined, buyer, ref };
    }));
  }

  if (!open) return <button className="vf-btn soft" onClick={() => setOpen(true)}>Record sales</button>;
  return (
    <div className="pt-pop" role="dialog" aria-label="Record sales">
      <div className="pt-pop-in bp-panel">
        <h2>Record sales</h2>
        {!products.length ? <p className="ap-note">Sales can be recorded once a product is approved.</p> : (
          <form onSubmit={(e) => { e.preventDefault(); send([{ product: f.product, channel: f.channel, country: f.country, city: f.city, qty: Number(f.qty), amountNgn: Math.round(Number(f.amount.replace(/[^\d.]/g, ""))), film: f.film }]); }}>
            <div className="ap-row">
              <label className="vf-field"><span>Product</span><div className="vf-box"><select value={f.product} onChange={set("product")}>{products.map((p) => <option key={p}>{p}</option>)}</select></div></label>
              <label className="vf-field"><span>Where</span><div className="vf-box"><select value={f.channel} onChange={set("channel")}><option value="own">Your shops</option><option value="stall">Premiere-night stall</option><option value="wholesale">Wholesale</option></select></div></label>
            </div>
            <div className="ap-row">
              <label className="vf-field"><span>Country</span><div className="vf-box"><select value={f.country} onChange={set("country")}>{countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select></div></label>
              <label className="vf-field"><span>City</span><div className="vf-box"><input value={f.city} onChange={set("city")} placeholder="Lagos" maxLength={60} /></div></label>
            </div>
            <div className="ap-row">
              <label className="vf-field"><span>Quantity</span><div className="vf-box"><input inputMode="numeric" value={f.qty} onChange={set("qty")} /></div></label>
              <label className="vf-field"><span>Total paid (₦)</span><div className="vf-box"><input required inputMode="numeric" value={f.amount} onChange={set("amount")} placeholder="7,500" /></div></label>
            </div>
            <label className="vf-field"><span>Film night, if any</span><div className="vf-box"><input value={f.film} onChange={set("film")} placeholder="Red Earth" maxLength={80} /></div></label>
            <p className="pt-hint">Or upload a spreadsheet saved as CSV with the columns <code>{HEAD}</code>. Buyer phone numbers are turned into a code before they are stored.</p>
            {msg && <p className="bp-flash" role="status">{msg}</p>}
            {err && <p className="vf-err" role="alert">{err}</p>}
            <div className="ap-act">
              <button type="button" className="vf-btn ghost" onClick={() => setOpen(false)}>Close</button>
              <label className="vf-btn soft">Upload CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
              <button className="vf-btn red" disabled={busy}>{busy ? "Saving" : "Add sale"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
