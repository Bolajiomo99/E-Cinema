import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { readLocale } from "@/lib/locale";

// The brand guide licensed partners design to; the AI brand rules check uses the same rules.
export const metadata = { title: "Brand guide · E-Cinema licensing" };

const RULES: [string, string][] = [
  ["Colours", "The E‑CINEMA wordmark is red #E3182D on dark, or white. Never another red, a gradient or an outline."],
  ["Clear space", "Keep space around the wordmark at least the height of its letter E. Keep it away from seams, zips and pocket edges."],
  ["No changes", "Do not stretch, tilt, recolour, crop or add effects to the wordmark, and do not put it inside another logo."],
  ["Film artwork", "Posters, characters and titles from a film need the studio's approval through E‑Cinema before you print them."],
  ["Labels", "Every item carries its own E‑Cinema QR label and hologram. Labels are made for your approved products only."],
  ["Samples", "Send a photo of a printed sample for every approved product before it goes on sale."],
];

export default async function BrandGuidePage() {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const body = (
    <div className="lp li">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <main className="li-guide">
        <p className="lp-eyebrow">BRAND GUIDE</p>
        <h1>Designing official E‑Cinema merch</h1>
        <div className="li-swatches" aria-hidden>
          <span style={{ background: "#e3182d" }}><b>E-CINEMA</b><small>#E3182D</small></span>
          <span style={{ background: "#0a0a0c" }}><b style={{ color: "#fff" }}>E-CINEMA</b><small>White on dark</small></span>
          <span style={{ background: "#0a0a0c" }}><b style={{ color: "#e3182d" }}>E-CINEMA</b><small>Red on dark</small></span>
        </div>
        <div className="li-feats">{RULES.map(([t, d]) => <div key={t} className="li-feat"><b>{t}</b><span>{d}</span></div>)}</div>
        <a className="lp-btn" href="/licensing/apply">Apply for a licence</a>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
