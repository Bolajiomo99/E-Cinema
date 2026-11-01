import Link from "next/link";
import PartnerSettingsForm from "@/components/licensing/PartnerSettingsForm";
import { myLicence, session } from "@/lib/licensing";
import { countryName } from "@/lib/worldmap";

// Settings: the public listing buyers see on the licensing page and the product checker.
export default async function PartnerSettings() {
  const mine = await myLicence(await session());
  const l = mine!.licensee;
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Settings</h1>
          <p>How your company appears to buyers on e-cinema.net/licensing and on the product checker</p>
        </div>
      </header>
      <section className="bp-panel">
        <h2>Public listing</h2>
        <div className="pt-v"><div><b>Company</b><small>{l.name} · {countryName(l.country)}</small></div><a className="vf-btn soft sm" href={`/licensing#${l.licence}`}>View</a></div>
        <PartnerSettingsForm city={l.city} website={l.website} owner={l.role === "owner"} />
      </section>
      <section className="bp-panel">
        <h2>Account</h2>
        <div className="pt-v"><div><b>Your role</b><small>{l.role === "owner" ? "Owner · you can manage payouts, renewals and the team" : "Staff"}</small></div></div>
        <div className="pt-v"><div><b>Sign-in, devices and notifications</b><small>Managed in your E‑Cinema account</small></div><Link className="vf-btn soft sm" href="/settings/account">Open</Link></div>
        <div className="pt-v"><div><b>Company name or registration change</b><small>Needs new papers, so the brand team does it</small></div><a className="vf-btn soft sm" href={`mailto:admin@e-cinema.net?subject=${encodeURIComponent(`Licence ${l.licence} details`)}`}>Email us</a></div>
      </section>
    </div>
  );
}
