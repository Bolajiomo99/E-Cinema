import CompanyLayout, { Person, Section } from "@/components/company/CompanyLayout";
import { showtimes } from "@/lib/catalog";

// Figma "Web / For studios" (94:1055).
export const metadata = { title: "For studios and distributors · E-Cinema", description: "Open your film to the whole world on one night. You keep 70% of every ticket." };

const STEPS: [string, string][] = [
  ["Verify your rights", "Upload rights papers and ID. Approval in about 3 working days."],
  ["Upload the film", "4K master or ProRes. AI checks picture, sound and subtitles."],
  ["Set prices and dates", "Per country, global night or a rolling start. Open pre-sales years ahead."],
  ["Premiere live", "Watch your audience in the live control room. Get paid monthly."],
];
const GETS: [string, string][] = [
  ["AI dubbing in 29 languages", "Voice-matched dubs from your subtitles. You approve every line."],
  ["Piracy protection", "Per-viewer watermarks, capture blocking and fast takedowns."],
  ["Analytics beyond streaming giants", "Live viewers by city, retention by minute, money by country."],
  ["Fast payouts", "Monthly by the 15th, in your currency, 70% to you."],
];

export default function ForStudiosPage() {
  const count = new Map<string, number>();
  for (const s of showtimes) count.set(s.studio, (count.get(s.studio) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const initials = (s: string) => s.split(/\s+/).slice(0, 2).map((w) => w[0]).join("");
  return (
    <CompanyLayout kicker="FOR STUDIOS AND DISTRIBUTORS" title="OPEN YOUR FILM TO THE WHOLE WORLD ON ONE NIGHT."
      lead="Sell tickets worldwide, in every local currency, with AI dubbing, piracy protection and analytics that show every viewer. You keep 70% of every ticket."
      actions={[["Apply as a studio", "/studio"], ["Read studio terms", "/legal/studios"]]}>
      <Section title="How it works">
        <ol className="cp-steps">
          {STEPS.map(([t, d], i) => <li key={t}><span className="cp-num">{i + 1}</span><b>{t}</b><p>{d}</p></li>)}
        </ol>
      </Section>
      <Section title="What you get">
        <div className="cp-grid">
          {GETS.map(([t, d]) => <div key={t} className="cp-tile"><b>{t}</b><p>{d}</p></div>)}
        </div>
      </Section>
      <Section title="Studios already premiering">
        <div className="cp-people">
          {top.map(([s, n]) => <Person key={s} initials={initials(s)} name={s} role={`${n} premiere${n === 1 ? "" : "s"} scheduled`} />)}
        </div>
        <p className="cp-fine">Studio names are examples while our first partners sign.</p>
      </Section>
    </CompanyLayout>
  );
}
