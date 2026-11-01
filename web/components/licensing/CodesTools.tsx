"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateName, type Codes } from "@/lib/licensing-types";
import { pcall } from "./pcall";

// "Order 5,000 labels" (Figma 116:532): codes are made for one approved product at a time.
export function OrderLabels({ products }: { products: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState(products[0]?.id ?? "");
  const [count, setCount] = useState(5000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ batch: string; n: number } | null>(null);
  if (!open) return <button className="vf-btn red" onClick={() => setOpen(true)}>Order {count.toLocaleString("en-GB")} labels</button>;
  return (
    <div className="pt-pop" role="dialog" aria-label="Order labels">
      <div className="pt-pop-in bp-panel">
        <h2>Order QR labels</h2>
        {!products.length ? <p className="ap-note">Labels are made for approved products. <a href="/partner/products">Submit a product</a> first.</p> : done ? (
          <>
            <p className="bp-flash" role="status">{done.n.toLocaleString("en-GB")} codes made in batch {done.batch}. Send the file to your printer, or print the sheet yourself.</p>
            <div className="ap-act">
              <button className="vf-btn ghost" onClick={() => { setOpen(false); setDone(null); }}>Close</button>
              <a className="vf-btn soft" href={`/api/licensing/partner/batch/${done.batch}`}>Download CSV</a>
              <a className="vf-btn red" href={`/partner/codes/print?batch=${done.batch}`} target="_blank" rel="noopener">Print labels</a>
            </div>
          </>
        ) : (
          <form onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true); setErr("");
            try {
              const r = await pcall<{ batch: string; codes: string[] }>("POST", "partner/codes", { productId: product, count });
              setDone({ batch: r.batch, n: r.codes.length });
              router.refresh();
            } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
          }}>
            <label className="vf-field"><span>Product</span><div className="vf-box"><select value={product} onChange={(e) => setProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div></label>
            <fieldset className="bp-q">
              <legend>How many</legend>
              <div className="bp-chips">{[500, 1000, 2500, 5000].map((n) => <button key={n} type="button" className={count === n ? "on" : ""} aria-pressed={count === n} onClick={() => setCount(n)}>{n.toLocaleString("en-GB")}</button>)}</div>
            </fieldset>
            <p className="pt-hint">Each code works once and is tied to this product and your licence. Labels are included in your licence fee.</p>
            {err && <p className="vf-err" role="alert">{err}</p>}
            <div className="ap-act">
              <button type="button" className="vf-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="vf-btn red" disabled={busy}>{busy ? "Making codes" : `Make ${count.toLocaleString("en-GB")} codes`}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function Batches({ batches }: { batches: Codes["batches"] }) {
  if (!batches.length) return null;
  return (
    <section className="bp-panel">
      <h2>Label batches</h2>
      <table className="pt-table">
        <thead><tr><th>Batch</th><th>Product</th><th>Codes</th><th>Scanned</th><th><span className="sr-only">Files</span></th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batch}>
              <td className="strong">{b.batch}<small>{dateName(b.createdAt)}</small></td>
              <td>{b.product}</td>
              <td>{b.count.toLocaleString("en-GB")}</td>
              <td>{b.scanned.toLocaleString("en-GB")}</td>
              <td className="pt-files"><a className="vf-btn soft sm" href={`/api/licensing/partner/batch/${b.batch}`}>CSV</a><a className="vf-btn soft sm" href={`/partner/codes/print?batch=${b.batch}`} target="_blank" rel="noopener">Print</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
