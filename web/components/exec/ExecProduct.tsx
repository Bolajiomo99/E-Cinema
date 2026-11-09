"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProductArt from "@/components/store/ProductArt";
import type { ShopProduct } from "@/lib/exec";

// Add a product (Figma 83:631); the same form edits an existing product.
const CATS: { id: string; label: string }[] = [
  { id: "gear", label: "Gear" }, { id: "clothing", label: "Clothing" }, { id: "accessories", label: "Bags" },
  { id: "snacks", label: "Snacks and drinks" }, { id: "gift", label: "Gift cards" },
];
const SHIPS: { id: string; label: string }[] = [
  { id: "world", label: "Ships worldwide" }, { id: "ng", label: "Ships in Nigeria" }, { id: "lagos", label: "Same day in Lagos" }, { id: "digital", label: "Sent by email" },
];
const COUNTRIES: { name: string; cur: string; sym: string }[] = [
  { name: "Kenya", cur: "KES", sym: "KSh " }, { name: "Ghana", cur: "GHS", sym: "GH₵" }, { name: "South Africa", cur: "ZAR", sym: "R" },
  { name: "United Kingdom", cur: "GBP", sym: "£" }, { name: "United States", cur: "USD", sym: "$" },
];

type Opt = { name: string; values: string };

export default function ExecProduct({ product, rates }: { product: ShopProduct | null; rates: Record<string, number> }) {
  const router = useRouter();
  const p = product;
  const [images, setImages] = useState<string[]>(p?.images ?? []);
  const [name, setName] = useState(p?.name ?? "");
  const [sub, setSub] = useState(p?.sub ?? "");
  const [blurb, setBlurb] = useState(p?.blurb ?? "");
  const [cat, setCat] = useState(p?.category ?? "gear");
  const init: Opt[] = (p?.options ?? []).map((o) => ({ name: o.name, values: o.values.join(", ") }));
  while (init.length < 2) init.push({ name: init.length ? "Size" : "Colours", values: "" });
  const [opts, setOpts] = useState<Opt[]>(init.slice(0, 2));
  const [price, setPrice] = useState(p ? String(p.priceNgn) : "");
  const [ships, setShips] = useState(p?.ships ?? "world");
  const [days, setDays] = useState(p ? String(p.shipDays) : "5");
  const [beforeShow, setBeforeShow] = useState(p?.beforeShow ?? false);
  const [active, setActive] = useState(true); // Publish shows it unless switched off; Save draft always hides it
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const naira = Number(price.replace(/[^0-9]/g, "")) || 0;
  const usdPerNgn = rates.NGN ? 1 / rates.NGN : 0;
  const local = (cur: string) => {
    if (!naira || !usdPerNgn || !rates[cur]) return "–";
    const v = naira * usdPerNgn * rates[cur];
    return Math.round(v).toLocaleString("en-US");
  };

  async function upload(f: File) {
    setErr(""); setBusy("photo");
    const fd = new FormData();
    fd.append("photo", f);
    const r = await fetch("/api/executive/products/photo", { method: "POST", body: fd }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { url?: string; error?: string };
    setBusy("");
    if (r?.ok && b.url) setImages((xs) => [...xs, b.url!].slice(0, 6));
    else setErr(b.error ?? "That photo could not be uploaded");
  }

  async function save(publish: boolean) {
    setErr(""); setBusy(publish ? "publish" : "draft");
    const body = {
      id: p?.id ?? "", name: name.trim(), sub: sub.trim(), blurb: blurb.trim(), category: cat, priceNgn: naira,
      options: opts.filter((o) => o.name.trim() && o.values.trim()).map((o) => ({ name: o.name.trim(), values: o.values.split(",").map((v) => v.trim()).filter(Boolean) })),
      ships, shipDays: Number(days) || 0, beforeShow, images, active: publish ? active : false,
    };
    const r = await fetch("/api/executive/products", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = (await r?.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy("");
    if (!r?.ok) { setErr(b.error ?? "Could not save the product"); return; }
    router.push("/executive/shop");
    router.refresh();
  }

  return (
    <section className="exc epf">
      <header className="exc-head">
        <div>
          <h1>{p ? "Edit product" : "Add a product"}</h1>
          <p className="exc-sub">Add merch, gear or snacks yourself. Prices are set in naira and shown in each buyer&apos;s currency.</p>
        </div>
        <div className="epf-acts">
          <Link href="/executive/shop" className="exa-ghost exn-btn">Cancel</Link>
          <button type="button" className="exa-ghost" disabled={!!busy} onClick={() => save(false)}>{busy === "draft" ? "Saving…" : "Save draft"}</button>
          <button type="button" className="exa-red" disabled={!!busy} onClick={() => save(true)}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
        </div>
      </header>
      {err && <p className="epf-err" role="alert">{err}</p>}

      <div className="epf-grid">
        <div className="epf-main">
          <div className="exc-card">
            <h2>Photos</h2>
            <div className="epf-photos">
              {images.map((src) => (
                <div key={src} className="epf-ph"><img src={src} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setImages((xs) => xs.filter((x) => x !== src))}>×</button></div>
              ))}
              {images.length < 6 && (
                <button type="button" className="epf-addph" disabled={busy === "photo"} onClick={() => file.current?.click()}>
                  <span>+</span><small>{busy === "photo" ? "Uploading…" : "Add photo"}</small>
                </button>
              )}
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
            </div>
            <p className="epf-hint">Upload photos that show the E-Cinema mark (JPEG, PNG or WebP, up to 5 MB). AI background removal and logo check <span className="exl-soon">Soon</span></p>
          </div>

          <div className="exc-card">
            <h2>Details</h2>
            <label className="epf-f"><span>Product name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="E-Cinema VR headset" /></label>
            <label className="epf-f"><span>Short line</span><input value={sub} maxLength={120} onChange={(e) => setSub(e.target.value)} placeholder="Front-row seat in every premiere" /></label>
            <label className="epf-f"><span>Description</span><textarea value={blurb} maxLength={600} rows={3} onChange={(e) => setBlurb(e.target.value)} placeholder="What it is, what it is made of, what comes in the box." /></label>
            <div className="epf-chips" role="radiogroup" aria-label="Category">
              {CATS.map((c) => <button key={c.id} type="button" role="radio" aria-checked={cat === c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>{c.label}</button>)}
              <span className="epf-chip-soon">Bundles <small>Soon</small></span>
            </div>
            <div className="epf-two">
              {opts.map((o, i) => (
                <div key={i} className="epf-f">
                  <input className="epf-optname" aria-label={`Option ${i + 1} name`} value={o.name} maxLength={30} onChange={(e) => setOpts((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input aria-label={`${o.name || "Option"} values`} value={o.values} onChange={(e) => setOpts((xs) => xs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} placeholder={i ? "S, M, L, XL" : "Black, White"} />
                </div>
              ))}
            </div>
          </div>

          <div className="exc-card">
            <h2>Price in each country</h2>
            <label className="epf-f epf-price"><span>Price in Nigeria (₦)</span><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="389000" /></label>
            <div className="exn-table epf-tbl" role="table" tabIndex={0} aria-label="Price in each country">
              <div className="exn-th epf-g" role="row"><span role="columnheader">Country</span><span role="columnheader">Price</span><span role="columnheader">Stock</span><span role="columnheader">Ships from</span></div>
              <div className="exn-tr epf-g" role="row"><span role="cell">Nigeria</span><span role="cell">{naira ? `₦${naira.toLocaleString("en-NG")}` : "–"}</span><span role="cell" className="exl-soon">Soon</span><span role="cell">Lagos</span></div>
              {COUNTRIES.map((c) => (
                <div key={c.cur} className="exn-tr epf-g" role="row"><span role="cell">{c.name}</span><span role="cell">{local(c.cur) === "–" ? "–" : `${c.sym}${local(c.cur)}`}</span><span role="cell" className="exl-soon">Soon</span><span role="cell">{ships === "world" || ships === "digital" ? "Lagos" : "Not shipped"}</span></div>
              ))}
            </div>
            <p className="epf-hint">Other currencies follow today&apos;s exchange rate. Local price overrides and AI price suggestions <span className="exl-soon">Soon</span></p>
          </div>

          <div className="exc-card">
            <h2>Delivery</h2>
            <div className="epf-two">
              <label className="epf-f"><span>How it ships</span>
                <select value={ships} onChange={(e) => setShips(e.target.value)}>{SHIPS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              </label>
              <label className="epf-f"><span>Days to deliver</span><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} /></label>
            </div>
            <label className="epf-tog"><span>Delivered before showtime<small>For snacks brought to your seat at a screening</small></span><input type="checkbox" role="switch" checked={beforeShow} onChange={(e) => setBeforeShow(e.target.checked)} /></label>
          </div>
        </div>

        <aside className="epf-side">
          <div className="exc-card">
            <h2>Preview in the shop</h2>
            <ProductArt id={p?.id ?? (name || "new")} name={name || "New product"} images={images} size={96} className="epf-prev" />
            <b className="epf-pn">{name || "Product name"}</b>
            <small className="epf-ps">{sub || "Short line"}</small>
            <div className="epf-pr"><b>{naira ? `₦${naira.toLocaleString("en-NG")}` : "₦–"}</b><span className="exa-red epf-cart">Add to cart</span></div>
          </div>
          <div className="exc-card">
            <h2>Visibility</h2>
            <label className="epf-tog"><span>Show in the shop</span><input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} /></label>
            <div className="epf-tog off"><span>Feature on home page</span><small className="exl-soon">Soon</small></div>
            <div className="epf-tog off"><span>VIP early access<small>48 hours before everyone</small></span><small className="exl-soon">Soon</small></div>
            <p className="epf-hint">The CEO and cabinet members allowed to add merch can add and edit. Save draft keeps it out of the shop.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
