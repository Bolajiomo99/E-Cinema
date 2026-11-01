import CompanyLayout, { Person, Section } from "@/components/company/CompanyLayout";
import { accountApi } from "@/lib/auth";
import { showtimes } from "@/lib/catalog";

// Figma "Web / About" (94:947). The numbers are counted live, never made up.
export const revalidate = 300;
export const metadata = { title: "About · E-Cinema", description: "Premieres, together. New films on opening night, in every language and currency." };

const DUB_LANGUAGES = 29; // what our AI dubbing voice model speaks

export default async function AboutPage() {
  const r = await accountApi("GET", "/v1/about").catch(() => ({ status: 0, body: null }));
  const live = r.status === 200 ? (r.body as { members: number; countries: number }) : null;
  const studios = new Set(showtimes.map((s) => s.studio)).size;
  const n = (v: number) => v.toLocaleString("en-GB");
  return (
    <CompanyLayout kicker="ABOUT E-CINEMA" title="PREMIERES, TOGETHER."
      lead="We bring new films to everyone on opening night, in their own language and currency, and let friends watch together from anywhere on Earth."
      actions={[["Join free", "/join"], ["For studios", "/for-studios"]]}>
      <Section title="E-Cinema in numbers">
        <div className="cp-stats">
          <div><b>{live ? n(live.countries) : "–"}</b><span>{live?.countries === 1 ? "country" : "countries"} our members join from</span></div>
          <div><b>{DUB_LANGUAGES}</b><span>languages, dubbed by AI</span></div>
          <div><b>{studios}</b><span>studios on the schedule</span></div>
          <div><b>{live ? n(live.members) : "–"}</b><span>members</span></div>
        </div>
        <p className="cp-fine">Counted live from our own records and refreshed every few minutes.</p>
      </Section>
      <Section title="Why we built it">
        <p className="cp-p">In much of the world a new film reaches cinemas months late, costs too much, or never arrives. Pirated copies fill the gap and studios lose. E‑Cinema gives every country the same premiere night at a fair local price, and pays studios 70% of every ticket.</p>
      </Section>
      <Section title="Leadership">
        <div className="cp-people">
          <Person initials="BJ" name="Bolaji Jimoh" role="Founder and CEO" />
          <Person initials="CF" name="Chief Financial Officer" role="We are hiring" href="/careers" />
          <Person initials="CT" name="Chief Technology Officer" role="We are hiring" href="/careers" />
        </div>
      </Section>
      <Section title="Press and partnerships">
        <p className="cp-p"><a href="mailto:admin@e-cinema.net?subject=Press">Press enquiries</a> · <a href="mailto:admin@e-cinema.net?subject=Partnerships">Partnerships</a></p>
        <p className="cp-fine">Online Cinema Ltd, trading as E-Cinema. Registered in Nigeria, RC 9947766.</p>
      </Section>
    </CompanyLayout>
  );
}
