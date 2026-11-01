import Link from "next/link";
import CompanyLayout, { Section } from "@/components/company/CompanyLayout";
import { jobBoard } from "@/lib/careers";
import { KIND, where } from "@/lib/careers-types";
import { nameOf } from "@/lib/countries";

// Figma "Web / Careers" (94:1157). Roles come from the hiring desk; none are invented.
export const revalidate = 120;
export const metadata = { title: "Careers · E-Cinema", description: "Build the cinema the whole world can walk into." };

export default async function CareersPage() {
  const b = await jobBoard();
  return (
    <CompanyLayout kicker="CAREERS" title="BUILD THE CINEMA THE WHOLE WORLD CAN WALK INTO."
      lead={`Anyone in any country can apply. ${b.ngShare}% of our roles are kept for Nigeria and ${100 - b.ngShare}% are open worldwide, with hubs in Lagos, Nairobi, London and Bengaluru.`}
      actions={[["See open roles", "/careers/jobs"], ["My applications", "/careers/applications"]]}>
      <Section title="Open roles">
        {b.jobs.length === 0 ? (
          <div className="cr-empty">
            <b>No open roles right now.</b>
            <p>We post every new role here first. Check back soon, or email your CV to <a href="mailto:admin@e-cinema.net?subject=Careers">admin@e-cinema.net</a> and we will keep it for 12 months.</p>
          </div>
        ) : (
          <table className="cr-table">
            <thead><tr><th>Role</th><th>Team</th><th>Where</th><th>Type</th><th><span className="sr-only">Apply</span></th></tr></thead>
            <tbody>
              {b.jobs.slice(0, 6).map((j) => (
                <tr key={j.slug}>
                  <td><Link href={`/careers/jobs/${j.slug}`}>{j.title}</Link></td>
                  <td>{j.team}</td>
                  <td>{where(j, nameOf)}</td>
                  <td>{KIND[j.kind]}</td>
                  <td><Link className="cr-apply" href={`/careers/jobs/${j.slug}#apply`}>Apply</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {b.total > 6 && <p className="cp-fine"><Link href="/careers/jobs">See all {b.total} roles</Link></p>}
      </Section>
      <Section title="What you get">
        <div className="cp-grid">
          {[
            ["Pay in your currency", "Fair salaries benchmarked per country, plus equity for everyone."],
            ["Work from anywhere", "Remote-first, with hubs in Lagos and Nairobi."],
            ["Learning budget", "$1,500 a year for courses, books and conferences."],
            ["Free Pro and VR", "Every premiere, a headset and snacks on us."],
          ].map(([t, d]) => <div key={t} className="cp-tile"><b>{t}</b><p>{d}</p></div>)}
        </div>
      </Section>
    </CompanyLayout>
  );
}
