import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import ProductArt from "@/components/store/ProductArt";
import ProductBuy from "@/components/store/ProductBuy";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { myQuote, pricing, storeProduct } from "@/lib/store";
import { CATEGORY, firstPart, INSTALMENT_MIN_NGN, INSTALMENT_PARTS, price, type Product, type Quote } from "@/lib/store-types";

// Built from the Figma frame "Web / Shop · Product detail" (96:1194).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const d = await storeProduct((await params).id);
  return { title: d ? `${d.product.name} · E-Cinema shop` : "Shop · E-Cinema", description: d?.product.blurb };
}

const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

// When it arrives, in words: snacks before the next premiere, everything else by weekday.
function delivery(p: Product, q: Quote | null, tz: string) {
  const where = q?.address ? [q.address.area, q.address.city].filter(Boolean).join(", ") : "";
  if (p.beforeShow) {
    if (q?.nextShow) {
      const t = new Date(q.nextShow.startsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: tz });
      return `Arrives before your ${q.nextShow.film} premiere (${t})${where ? ` in ${where}` : ""}`;
    }
    return where ? `Same-day delivery to ${where}` : "Same-day delivery in Lagos";
  }
  const day = new Date(Date.now() + Math.max(1, p.shipDays) * 86_400_000).toLocaleDateString("en-GB", { weekday: "long", timeZone: tz });
  return where ? `Delivers ${day} to ${where}` : `Delivers by ${day} in Nigeria · a few days more abroad`;
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === "gift-card") redirect("/gift?kind=credit");
  const [d, me, loc] = await Promise.all([storeProduct(id), currentAccount(), readLocale()]);
  if (!d) notFound();
  const { product: p, reviews } = d;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [px, q] = await Promise.all([pricing(loc.country), me && session ? myQuote(session, loc.country) : Promise.resolve(null)]);
  const tz = loc.country === "NG" || !loc.country ? "Africa/Lagos" : "UTC";
  const notes = [
    `Free returns within 14 days`,
    p.category === "gear" ? "1-year warranty" : "",
    p.ships === "lagos" ? "Lagos only" : p.ships === "ng" ? "Ships within Nigeria" : "",
    "pay on delivery available in Lagos",
  ].filter(Boolean);

  const body = (
    <div className="lp sh">
      <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
      <main className="pd">
        <div className="pd-gal">
          <ProductArt id={p.id} name={p.name} images={p.images} className="pd-photo" size={180} />
          {p.images.length > 1 && (
            <div className="pd-th">
              {p.images.slice(0, 4).map((src) => <ProductArt key={src} id={p.id} name={p.name} images={[src]} className="pd-thumb" />)}
            </div>
          )}
        </div>
        <section className="pd-info">
          <p className="sh-muted"><Link href="/shop">Shop</Link> · <Link href={`/shop?c=${p.category === "gift" ? "accessories" : p.category}`}>{CATEGORY[p.category]}</Link></p>
          <h1 className="pd-h1">{p.name.toUpperCase()}</h1>
          <p className="pd-r">
            {p.reviews > 0 ? (
              <><span className="pd-stars" aria-label={`${p.stars} out of 5`}>{stars(p.stars)}</span><span>{p.stars.toFixed(1)} · {p.reviews.toLocaleString("en")} review{p.reviews === 1 ? "" : "s"}</span></>
            ) : (
              <span>No reviews yet · buyers can review after delivery</span>
            )}
          </p>
          <p className="pd-price">{price(p.priceNgn, px)}</p>
          {p.priceNgn >= INSTALMENT_MIN_NGN && <p className="sh-muted">or {INSTALMENT_PARTS} × {price(firstPart(p.priceNgn), px)} with Paystack instalments, chosen in the cart</p>}
          <p className="pd-blurb">{p.blurb}</p>
          <ProductBuy productId={p.id} options={p.options} signedIn={Boolean(me)} />
          <div className="pd-del">
            <p>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
              {delivery(p, q, tz)}
            </p>
            <small>{notes.join(" · ")}</small>
          </div>
          {reviews.length > 0 && (
            <div className="pd-reviews">
              <h2>What buyers say</h2>
              {reviews.map((r, i) => (
                <div key={i} className="pd-rev">
                  <span className="pd-stars">{stars(r.stars)}</span> <strong>{r.name}</strong>
                  {r.body && <p>{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
