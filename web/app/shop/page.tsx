import Link from "next/link";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import AddToCart from "@/components/store/AddToCart";
import ProductArt from "@/components/store/ProductArt";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { pricing, storeProducts } from "@/lib/store";
import { defaultVariant, price, type Product } from "@/lib/store-types";

// Built from the Figma frame "Web / Shop" (53:925).
export const dynamic = "force-dynamic";
export const metadata = { title: "Shop · E-Cinema", description: "Watch gear, clothing and snacks delivered before your premiere." };

const CHIPS: { id: string; label: string; match: (p: Product) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "gear", label: "Watch gear", match: (p) => p.category === "gear" },
  { id: "clothing", label: "Clothing", match: (p) => p.category === "clothing" },
  { id: "snacks", label: "Snacks for tonight", match: (p) => p.category === "snacks" },
  { id: "accessories", label: "Accessories", match: (p) => p.category === "accessories" || p.category === "gift" },
  { id: "before", label: "Delivers before showtime", match: (p) => p.beforeShow },
];

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const [sp, me, loc, products] = await Promise.all([searchParams, currentAccount(), readLocale(), storeProducts()]);
  const px = await pricing(loc.country);
  const chip = CHIPS.find((c) => c.id === sp.c) ?? CHIPS[0];
  const list = products.filter(chip.match);
  const hero = products.find((p) => p.id === "vr-headset");

  const body = (
    <div className="lp sh">
      <TopNav me={me} active="shop" t={loc.t} country={loc.country} lang={loc.lang} />
      {hero && (
        <header className="sh-hero">
          <div className="sh-hero-glow" aria-hidden />
          <div className="sh-hero-c">
            <span className="sh-new">NEW</span>
            <h1>THE E-CINEMA VR HEADSET</h1>
            <p>Front-row seat at every premiere. 4K per eye, spatial audio, made for E‑Cinema VR halls.</p>
            <div className="sh-hero-b">
              <Link href="/shop/vr-headset" className="sh-btn">Buy · {price(hero.priceNgn, px)}</Link>
              <span className="sh-muted">or 6 × {price(Math.ceil(hero.priceNgn / 6 / 100) * 100, px)} · instalments <span className="soon-tag">soon</span></span>
            </div>
          </div>
          <Link href="/shop/vr-headset" className="sh-hero-img" aria-label="See the VR headset">
            <ProductArt id={hero.id} name={hero.name} images={hero.images} size={120} />
          </Link>
        </header>
      )}
      <main className="sh-body">
        <div className="sh-f">
          <h2>Shop E-Cinema</h2>
          <nav className="sh-chips" aria-label="Filter products">
            {CHIPS.map((c) => (
              <Link key={c.id} href={c.id === "all" ? "/shop" : `/shop?c=${c.id}`} className={`sh-chip${c.id === chip.id ? " on" : ""}`} aria-current={c.id === chip.id ? "page" : undefined}>{c.label}</Link>
            ))}
          </nav>
        </div>
        {products.length === 0 ? (
          <p className="sh-empty">The shop is restocking. Check back in a few minutes.</p>
        ) : (
          <div className="sh-grid">
            {list.map((p) => (
              <article key={p.id} className="sh-card">
                <Link href={p.id === "gift-card" ? "/gift?kind=credit" : `/shop/${p.id}`} className="sh-img">
                  <ProductArt id={p.id} name={p.name} images={p.images} />
                </Link>
                <div className="sh-t">
                  <div className="sh-n">
                    <Link href={p.id === "gift-card" ? "/gift?kind=credit" : `/shop/${p.id}`}>{p.name}</Link>
                    {p.sub && <small>{p.sub}</small>}
                  </div>
                  <strong>{p.id === "gift-card" ? `From ${price(p.priceNgn, px)}` : price(p.priceNgn, px)}</strong>
                </div>
                <span className="sh-push" />
                {p.id === "gift-card" ? (
                  <Link href="/gift?kind=credit" className="sh-btn sec sm">Send a gift card</Link>
                ) : (
                  <AddToCart productId={p.id} variant={defaultVariant(p)} signedIn={Boolean(me)} />
                )}
              </article>
            ))}
          </div>
        )}
        {px.currency !== "NGN" && <p className="sh-note">Prices shown in {px.currency} at today&apos;s rate. Delivery and VAT follow your delivery address.</p>}
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
