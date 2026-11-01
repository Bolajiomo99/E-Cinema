import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import MerchArt from "@/components/licensing/MerchArt";
import { currentAccount } from "@/lib/auth";
import { licensees } from "@/lib/brand";
import { PLAN_LINE, PLANS } from "@/lib/licensing-types";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";
import { pricing } from "@/lib/store";
import { price } from "@/lib/store-types";

// Built from the Figma frame "Web / Licensing · Sell official E-Cinema merch" (114:1933).
export const dynamic = "force-dynamic";
export const metadata = { title: "Sell official E-Cinema merch · Licensing", description: "Makers and shops in any country can buy a licence to make and sell official E-Cinema merch." };

const WHAT: [string, string][] = [
  ["Your own dashboard", "Sales, scans and payouts by product, city and country, live."],
  ["Authentic QR labels", "Every item gets a one-time code buyers can check on our site."],
  ["Sell on E‑Cinema", "Growth and Global partners appear in the E‑Cinema shop to every member."],
  ["Protection", "Our investigators and community chase fakes in your market."],
];
const STEPS: [string, string][] = [
  ["Apply", "Company papers, factory photos and sample designs."],
  ["Get approved", "Brand team checks quality in about 5 working days."],
  ["Pay the licence", "Any local method or PayPal."],
  ["Start selling", "Order QR labels and go live."],
];

export default async function LicensingPage() {
  const [me, loc, list] = await Promise.all([currentAccount(), readLocale(), licensees()]);
  const px = await pricing(loc.country);
  const where = px.currency === "NGN" ? "Nigeria" : countryName(loc.country) || "your country";
  const body = (
    <div className="lp li">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <header className="li-hero">
        <div className="li-copy">
          <p className="lp-eyebrow">LICENSED MERCH PARTNERS</p>
          <h1 className="lp-display-l">PUT THE E‑CINEMA LOGO ON YOUR PRODUCTS, LEGALLY.</h1>
          <p className="lp-body-l">Makers and shops in any country can buy a licence to make and sell official E‑Cinema merch. You get your own dashboard with every sale, scan and payout.</p>
          <div className="li-b">
            <a className="lp-btn" href="/licensing/apply">Apply for a licence</a>
            <a className="lp-btn ghost" href="/licensing/brand-guide">Brand guide</a>
          </div>
        </div>
        <MerchArt />
      </header>
      <section className="li-sec">
        <h2>Licence plans</h2>
        <p className="li-sub">Prices follow your country and currency. Fees shown for {where}.</p>
        <div className="li-plans">
          {PLANS.map((p) => (
            <div key={p.id} className="li-plan">
              <b>{p.name}</b>
              <strong>{p.feeNgn ? `${price(p.feeNgn, px)} a year` : "Talk to us"}</strong>
              <em>+ {p.royaltyPct}% of sales</em>
              <span>{PLAN_LINE[p.id]}</span>
              {p.feeNgn ? (
                <a className={`vf-btn ${p.id === "growth" ? "red" : "soft"}`} href={`/licensing/apply?plan=${p.id}`}>Choose {p.name}</a>
              ) : (
                <a className="vf-btn soft" href="mailto:admin@e-cinema.net?subject=Global%20merch%20licence">Talk to sales</a>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="li-sec">
        <h2>What you get</h2>
        <div className="li-feats">
          {WHAT.map(([t, d]) => <div key={t} className="li-feat"><b>{t}</b><span>{d}</span></div>)}
        </div>
      </section>
      <section className="li-sec">
        <h2>How to start</h2>
        <ol className="li-steps">
          {STEPS.map(([t, d], i) => <li key={t}><span>{i + 1}</span><b>{t}</b><small>{d}</small></li>)}
        </ol>
      </section>
      <section className="li-sec" id="partners">
        <h2>Licensed partners</h2>
        <div className="li-feats">
          {list.map((l) => (
            <div key={l.licence} id={l.licence} className="li-feat">
              <b>{l.name}</b>
              <span>{l.licence} · {[l.city, countryName(l.country)].filter(Boolean).join(", ")}{l.website && <> · <a href={`https://${l.website}`} rel="noopener noreferrer" target="_blank">{l.website}</a></>}</span>
            </div>
          ))}
          <div className="li-feat">
            <b>Bought from someone else?</b>
            <span>Check the label on <a href="/verify">e-cinema.net/verify</a></span>
          </div>
        </div>
      </section>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
