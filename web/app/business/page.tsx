import CompanyLayout, { Section } from "@/components/company/CompanyLayout";
import QuoteForm from "@/components/careers/QuoteForm";
import { countryOptions } from "@/lib/countries";
import { readLocale } from "@/lib/locale";

// Figma "Web / For business" (94:1239).
export const metadata = { title: "For business · E-Cinema", description: "Private screenings for your team, school or church, for up to 50,000 people." };

export default async function BusinessPage() {
  const loc = await readLocale();
  return (
    <CompanyLayout kicker="E-CINEMA FOR BUSINESS" title="PRIVATE SCREENINGS FOR YOUR TEAM, SCHOOL OR CHURCH."
      lead="Book a premiere for up to 50,000 people, branded with your logo, with seats paid by you or by each guest."
      actions={[["Talk to sales", "#quote"], ["See Enterprise plan", "/plans"]]}>
      <Section title="Made for groups">
        <div className="cp-grid">
          {[
            ["Companies", "Team nights, launches and town halls with a film."],
            ["Schools and universities", "Age-checked screenings with discussion rooms."],
            ["Churches and mosques", "Faith films with live prayer and Q&A rooms."],
            ["Brands", "Sponsor a premiere and reach millions in one night."],
          ].map(([t, d]) => <div key={t} className="cp-tile"><b>{t}</b><p>{d}</p></div>)}
        </div>
      </Section>
      <Section title="Get a quote" id="quote">
        <QuoteForm country={loc.country ?? ""} countries={countryOptions()} />
      </Section>
    </CompanyLayout>
  );
}
