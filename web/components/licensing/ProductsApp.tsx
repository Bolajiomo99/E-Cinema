"use client";
/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import ProductArt from "@/components/store/ProductArt";
import { naira, dateName, type Licensee, type Product } from "@/lib/licensing-types";
import { countryName } from "@/lib/worldmap";
import { pcall, upload } from "./pcall";

// Figma "Licensee / Products and approvals" (116:300): every product, its approval state and
// the AI brand rules check that runs before the brand team looks.
const STATUS: Record<Product["status"], [string, string]> = {
  live: ["teal", "Live"], review: ["purple", "In review"], changes: ["amber", "Changes asked"], rejected: ["red", "Rejected"],
};
const CHECK: Record<string, [string, string]> = { pass: ["teal", "Pass"], fail: ["red", "Fail"], needed: ["amber", "Needed"] };
const FILTERS: [string, string][] = [["all", "All"], ["live", "Live"], ["review", "In review"], ["changes", "Changes asked"], ["rejected", "Rejected"]];

export function Picture({ p, className }: { p: Pick<Product, "name" | "image">; className: string }) {
  if (p.image) return <img className={className} src={p.image} alt="" />;
  const id = /hood/i.test(p.name) ? "premiere-hoodie" : /cap/i.test(p.name) ? "premiere-cap" : /tote|bag/i.test(p.name) ? "tote-bag" : /umbrella/i.test(p.name) ? "umbrella" : "logo-tshirt";
  return <ProductArt id={id} name="" className={className} size={30} />;
}

function line(p: Product, l: Licensee) {
  if (p.status === "live") return `Live in ${l.countries.map((c) => countryName(c, true)).join(", ")} · ${p.sold.toLocaleString("en-GB")} sold · ${naira(p.priceNgn)}`;
  if (p.status === "review") return p.sampleKey ? "Brand team reviewing print sample" : "Brand team reviewing the design";
  return p.note || (p.status === "changes" ? "Fix and resubmit" : "Not approved");
}

export default function ProductsApp({ initial, licensee: l, films, startNew }: { initial: Product[]; licensee: Licensee; films: string[]; startNew: boolean }) {
  const [list, setList] = useState(initial);
  const [filter, setFilter] = useState("all");
  const [sel, setSel] = useState(initial[0]?.id ?? "");
  const [adding, setAdding] = useState(startNew);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [flash, setFlash] = useState("");
  const fix = useRef<HTMLInputElement>(null);
  const sample = useRef<HTMLInputElement>(null);

  const count = (f: string) => (f === "all" ? list.length : list.filter((p) => p.status === f).length);
  const shown = filter === "all" ? list : list.filter((p) => p.status === filter);
  const cur = list.find((p) => p.id === sel);

  async function reload() {
    const r = await pcall<{ products: Product[] }>("GET", "partner/products");
    setList(r.products);
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setErr("");
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }

  async function resubmit(kind: "design" | "sample", f?: File) {
    if (!f || !cur) return;
    await run(kind, async () => {
      const up = await upload(kind === "design" ? "design" : "photo", f);
      const body = kind === "design" ? { imageKey: up.key, film: cur.film } : { sampleKey: up.key, checks: cur.checks };
      await pcall("POST", `partner/products/${cur.id}`, body);
      await reload();
      setFlash(kind === "design" ? "New design sent. The AI check ran again and the brand team will look." : "Sample photo added.");
    });
    if (fix.current) fix.current.value = "";
    if (sample.current) sample.current.value = "";
  }

  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Products and approvals</h1>
          <p>Every product with our logo must be approved before you sell it</p>
        </div>
        <button className="vf-btn red" onClick={() => setAdding(true)}>Submit a new product</button>
      </header>
      {flash && <p className="bp-flash" role="status">{flash}</p>}
      {adding && <NewProduct films={films} max={l.plan.maxProducts} have={list.length} onClose={() => setAdding(false)} onDone={async (p) => { setAdding(false); await reload(); setSel(p.id); setFlash(`${p.name} sent. The AI brand check is done and the brand team will review it in about 5 working days.`); }} />}
      <div className="bp-chips" role="tablist" aria-label="Filter products">
        {FILTERS.map(([f, label]) => <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{label} {count(f)}</button>)}
      </div>
      <section className="bp-panel pt-list">
        {shown.length ? shown.map((p) => (
          <button key={p.id} className={`pt-v tall pick ${p.id === sel ? "on" : ""}`} onClick={() => setSel(p.id)} aria-pressed={p.id === sel}>
            <Picture p={p} className="pt-photo" />
            <div><b>{p.name}{p.detail ? ` · ${p.detail}` : ""}</b><small>{line(p, l)}</small></div>
            <span className={`bp-pill ${STATUS[p.status][0]}`}>{STATUS[p.status][1]}</span>
          </button>
        )) : <p className="pt-empty">{list.length ? "Nothing here." : "No products yet. Submit your first design to get it approved."}</p>}
      </section>
      {cur && (
        <section className="bp-panel">
          <h2>Brand rules check (AI, before human review){list.length > 1 ? ` · ${cur.name}` : ""}</h2>
          {cur.checks.map((c) => (
            <div key={c.name} className="pt-v">
              <div><b>{c.name}</b><small>{c.detail}</small></div>
              <span className={`bp-pill ${CHECK[c.result]?.[0] ?? "grey"}`}>{CHECK[c.result]?.[1] ?? c.result}</span>
            </div>
          ))}
          <div className="pt-actions">
            <small>{cur.status === "live" && cur.liveAt ? `Approved ${dateName(cur.liveAt)}` : `Sent ${dateName(cur.createdAt)}`}{cur.film ? ` · ${cur.film} artwork` : ""}</small>
            {(cur.status === "changes" || cur.status === "rejected") && <button className="vf-btn soft sm" disabled={!!busy} onClick={() => fix.current?.click()}>{busy === "design" ? "Checking" : "Upload a fixed design"}</button>}
            {cur.checks.some((c) => c.name === "Quality sample" && c.result !== "pass") && cur.status !== "rejected" && <button className="vf-btn soft sm" disabled={!!busy} onClick={() => sample.current?.click()}>{busy === "sample" ? "Uploading" : "Add sample photo"}</button>}
            {cur.status === "live" && <a className="vf-btn soft sm" href="/partner/codes">Order labels</a>}
          </div>
          <input ref={fix} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => resubmit("design", e.target.files?.[0])} />
          <input ref={sample} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => resubmit("sample", e.target.files?.[0])} />
          {err && <p className="vf-err" role="alert">{err}</p>}
        </section>
      )}
    </div>
  );
}

function NewProduct({ films, max, have, onClose, onDone }: { films: string[]; max: number; have: number; onClose: () => void; onDone: (p: Product) => void }) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [price, setPrice] = useState("");
  const [film, setFilm] = useState("");
  const [pic, setPic] = useState<{ key: string; url?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const full = max > 0 && have >= max;
  return (
    <section className="bp-panel pt-new" aria-label="Submit a new product">
      <h2>Submit a new product</h2>
      {full ? <p className="ap-note warn">Your plan allows {max} products. <a href="/partner/licence">Upgrade</a> to add more.</p> : (
        <form onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          if (!pic) return setErr("Add a picture of the design");
          setBusy("send");
          try {
            onDone(await pcall<Product>("POST", "partner/products", { name, detail, priceNgn: Math.round(Number(price.replace(/[^\d.]/g, ""))), film, imageKey: pic.key }));
          } catch (x) { setErr((x as Error).message); } finally { setBusy(""); }
        }}>
          <div className="ap-row">
            <label className="vf-field"><span>Product name</span><div className="vf-box"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Premiere tee, black" maxLength={80} /></div></label>
            <label className="vf-field"><span>Sizes, colours or details</span><div className="vf-box"><input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="sizes S to XXL" maxLength={120} /></div></label>
          </div>
          <div className="ap-row">
            <label className="vf-field"><span>Your price (₦)</span><div className="vf-box"><input required inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="7,500" /></div></label>
            <label className="vf-field"><span>Film artwork used</span><div className="vf-box"><select value={film} onChange={(e) => setFilm(e.target.value)}><option value="">None, logo only</option>{films.map((f) => <option key={f}>{f}</option>)}</select></div></label>
          </div>
          <div className="ap-v">
            {pic?.url ? <img className="pt-photo" src={pic.url} alt="" /> : null}
            <div><b>Design picture</b><small>{pic ? "Added · the AI brand check runs when you send" : "A clear flat picture or mock-up, JPG or PNG"}</small></div>
            <label className="vf-btn soft sm">{busy === "pic" ? "Uploading" : pic ? "Replace" : "Upload"}
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy("pic"); setErr("");
                try { setPic(await upload("design", f)); } catch (x) { setErr((x as Error).message); } finally { setBusy(""); }
              }} />
            </label>
          </div>
          {err && <p className="vf-err" role="alert">{err}</p>}
          <div className="ap-act">
            <button type="button" className="vf-btn ghost" onClick={onClose}>Cancel</button>
            <button className="vf-btn red" disabled={!!busy}>{busy === "send" ? "Checking the design" : "Send for approval"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
