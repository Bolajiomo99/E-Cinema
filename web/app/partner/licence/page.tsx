import CaseFix from "@/components/licensing/CaseFix";
import RenewLicence from "@/components/licensing/RenewLicence";
import { myLicence, partnerPage, session } from "@/lib/licensing";
import { dateName, PLANS, type Case, type Compliance } from "@/lib/licensing-types";
import { countryName } from "@/lib/worldmap";

// Figma "Licensee / Licence and compliance" (116:726).
function Step({ ok, title, detail }: { ok: boolean; title: string; detail: string }) {
  return (
    <div className="pt-step">
      <span className={ok ? "ok" : "bad"} aria-label={ok ? "Met" : "Needs attention"}>
        <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ok ? <path d="M3 7.5l2.5 2.5L11 4.5" /> : <path d="M7 3.5v4.5M7 10.5v.01" />}</svg>
      </span>
      <div><b>{title}</b><small>{detail}</small></div>
    </div>
  );
}

const CASE: Record<Case["status"], [string, string]> = { open: ["red", "Fix needed"], fixed: ["amber", "Being checked"], closed: ["teal", "Closed"], suspended: ["red", "Licence suspended"] };

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - new Date().getTime()) / 86400000);

export default async function PartnerLicence() {
  const s = await session();
  const [mine, c, cs] = await Promise.all([myLicence(s), partnerPage<Compliance>(s, "compliance"), partnerPage<{ cases: Case[] }>(s, "cases")]);
  const cases = cs?.cases ?? [];
  if (!mine || !c) return <p className="pt-empty">Your licence could not load. Refresh to try again.</p>;
  const l = mine.licensee;
  const days = daysUntil(l.validUntil);
  const status = l.status !== "active" ? ["red", l.status === "suspended" ? "Suspended" : "Ended"] : days < 0 ? ["red", "Expired"] : days <= 30 ? ["amber", `${days} days left`] : ["teal", "Active"];
  const verdict = c.score >= 90 ? "Excellent" : c.score >= 75 ? "Good" : c.score >= 60 ? "Needs work" : "At risk";
  const late = c.samplesTotal - c.samplesOnTime;
  const bigger = PLANS.filter((p) => p.feeNgn > 0 && (p.id === l.plan.id || (l.plan.id === "starter" && p.id === "growth")));
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Licence and compliance</h1>
          <p>Your licence, where you may sell, and the rules</p>
        </div>
        {l.plan.id !== "global" && <a className="vf-btn red" href={`mailto:admin@e-cinema.net?subject=${encodeURIComponent(`Upgrade ${l.licence} to Global`)}`}>Upgrade to Global</a>}
      </header>
      <div className="pt-row d">
        <section className="bp-panel">
          <h2>Your licence</h2>
          <div className="pt-v"><div><b>Plan</b><small>{l.plan.name} · {l.plan.maxCountries ? `${l.plan.maxCountries} ${l.plan.maxCountries === 1 ? "country" : "countries"}` : "any country"} · {l.plan.maxProducts ? `${l.plan.maxProducts} products` : "unlimited products"}</small></div><span className={`bp-pill ${status[0]}`}>{status[1]}</span></div>
          <div className="pt-v"><div><b>Countries</b><small>{l.countries.length ? l.countries.map((x) => countryName(x)).join(", ") : "Any country"}</small></div></div>
          <div className="pt-v"><div><b>Valid</b><small>{dateName(l.validFrom)} to {dateName(l.validUntil)}</small></div>{l.role === "owner" && bigger.length > 0 && <RenewLicence plans={bigger} current={l.plan.id} payReady={Boolean(process.env.PAYPAL_CLIENT_ID)} />}</div>
          <div className="pt-v"><div><b>Licence number</b><small>{l.licence} · shown on every label</small></div></div>
        </section>
        <section className="bp-panel">
          <h2>Compliance score</h2>
          <p className={`pt-score ${c.score < 75 ? "low" : ""}`}>{c.score} / 100</p>
          <p className="pt-verdict">{verdict}.{late > 0 ? ` ${late === 1 ? "One late sample photo" : `${late} late sample photos`} this year.` : " Every sample photo was on time."}{c.rejected ? ` ${c.rejected} product${c.rejected === 1 ? "" : "s"} not approved.` : ""}</p>
          <Step ok={late === 0 || c.samplesOnTime / Math.max(1, c.samplesTotal) >= 0.8} title="Quality samples on time" detail={c.samplesTotal ? `${c.samplesOnTime} of ${c.samplesTotal}` : "None due yet"} />
          <Step ok={c.unapproved === 0} title={c.unapproved ? `${c.unapproved} open compliance case${c.unapproved === 1 ? "" : "s"}` : "No unapproved products found"} detail={`Market checks: ${c.marketChecks}`} />
          <Step ok={c.royaltiesOk === c.royaltiesTotal} title="Royalties paid on time" detail={c.royaltiesTotal ? `${c.royaltiesOk} of ${c.royaltiesTotal}` : "None due yet"} />
        </section>
      </div>
      {cases.length > 0 && (
        <section className="bp-panel">
          <h2>Compliance cases</h2>
          {cases.map((x) => (
            <div key={x.id} id={x.number} className="pt-case">
              <div className="pt-v">
                <div><b>{x.number} · {x.issue}{x.place ? ` in ${x.place}` : ""}</b><small>{x.finding}</small></div>
                <span className={`bp-pill ${CASE[x.status][0]}`}>{CASE[x.status][1]}</span>
              </div>
              {(x.status === "open" || x.status === "fixed") && (
                <>
                  <p className="pt-hint">{x.status === "fixed" ? `You told us: ${x.partnerNote} The brand team will check and close the case.` : `Fix it by ${dateName(x.fixBy)}, or your licence is suspended.`}</p>
                  {l.status === "active" && <CaseFix id={x.id} fixed={x.status === "fixed"} />}
                </>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="bp-panel">
        <h2>Rules in short</h2>
        <p className="pt-rules">Only approved products may carry the logo · prices are yours to set · no selling in countries outside your licence · every item needs an E‑Cinema code · breaking the rules can end the licence with 30 days notice.</p>
        <a className="vf-btn soft sm" href="/licensing/agreement">Read the full licence agreement</a>
      </section>
    </div>
  );
}
