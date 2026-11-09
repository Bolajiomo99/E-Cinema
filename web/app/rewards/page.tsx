import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { myRewards } from "@/lib/brand";
import { naira, reportPill, where } from "@/lib/brand-types";
import { readLocale } from "@/lib/locale";
import { countryName } from "@/lib/plans";

// Built from the Figma frame "Web / Rewards · Brand protection" (114:1670).
export const dynamic = "force-dynamic";
export const metadata = { title: "Community rewards · E-Cinema", description: "Earn rewards for reporting fake E-Cinema merch and unlicensed use of our logo." };

const COLORS = ["#b5101f", "#2bb3a3", "#8b7cf6"];
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").replace(".", "").slice(0, 2).toUpperCase();

const STEPS: [string, string][] = [
  ["Spot it", "Merch with our logo but no E‑Cinema hologram or QR code"],
  ["Report it", "Photos, link or place. Your name stays private"],
  ["We check", "A brand investigator confirms within 5 working days"],
  ["Get paid", "₦5,000 to ₦50,000, paid into your wallet"],
];

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=%2Frewards");
  const sp = await searchParams;
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const loc = await readLocale();
  const r = await myRewards(session, loc.country);
  const country = r?.country || loc.country || "NG";
  const place = countryName(country);
  return (
    <DashShell>
      <div className="lp bp">
        <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
        <main id="main" className="bp-body">
          <header className="bp-head">
            <div>
              <h1>Community rewards</h1>
              <p>Earn rewards for keeping E‑Cinema honest. Report anyone selling fake E‑Cinema merch or using our logo without a licence.</p>
            </div>
            <a className="vf-btn red" href="/rewards/report">Report a fake seller</a>
          </header>
          {sp.sent === "1" && <p className="bp-flash" role="status">Report sent. An investigator will look at it within 5 working days, and you will get a notification either way.</p>}
          {!r ? (
            <p className="bp-flash warn">Your rewards could not be loaded just now. Refresh to try again.</p>
          ) : (
            <>
              <div className="bp-kpis">
                <div className="bp-kpi"><span>Your points</span><b>{r.points.toLocaleString()}</b><em className={r.monthPoints < 0 ? "neg" : ""}>{r.monthPoints >= 0 ? "+" : ""}{r.monthPoints.toLocaleString()} this month</em></div>
                <div className="bp-kpi"><span>Reports confirmed</span><b>{r.confirmed}</b><em>of {r.sent} sent</em></div>
                <div className="bp-kpi"><span>Rewards earned</span><b>{naira(r.rewardNgn)}</b><em>paid to your wallet</em></div>
                <div className="bp-kpi"><span>Your rank</span><b>{r.rank ? `#${r.rank}` : "—"}</b><em className="muted">{r.rank ? `in ${place} this month` : "earn points to get ranked"}</em></div>
              </div>
              <div className="bp-row">
                <section className="bp-panel bp-reports">
                  <h2>My reports</h2>
                  {r.reports.length === 0 ? (
                    <div className="bp-empty">
                      <p>No reports yet. Seen fake E‑Cinema merch? Tell us where.</p>
                      <a className="vf-btn ghost" href="/rewards/report">Report a fake seller</a>
                    </div>
                  ) : (
                    <table>
                      <thead><tr><th>Seller</th><th>Where</th><th>Status</th><th>Reward</th></tr></thead>
                      <tbody>
                        {r.reports.map((x) => {
                          const pill = reportPill(x);
                          return (
                            <tr key={x.id}>
                              <td className="bp-seller">{x.selling.length > 48 ? `${x.selling.slice(0, 46)}…` : x.selling}<small>{x.link}</small></td>
                              <td>{where(x)}</td>
                              <td><span className={`bp-pill ${pill.tone}`}>{pill.text}</span></td>
                              <td>{x.status === "confirmed" ? naira(x.rewardNgn) : x.status === "sent" || x.status === "checking" ? "Pending" : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </section>
                <div className="bp-col">
                  <section className="bp-panel">
                    <h2>How rewards work</h2>
                    <ol className="bp-steps">
                      {STEPS.map(([t, d]) => (
                        <li key={t}>
                          <span aria-hidden><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
                          <div><b>{t}</b><small>{d}</small></div>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section className="bp-panel">
                    <h2>Top reporters this month</h2>
                    {r.top.length === 0 ? (
                      <p className="bp-none">No confirmed reports in {place} yet this month. Yours could be first.</p>
                    ) : (
                      <ul className="bp-top">
                        {r.top.map((t, i) => (
                          <li key={i}>
                            <span className="bp-av" style={{ background: COLORS[i % 3] }}>{initials(t.name)}</span>
                            <b>{t.name}{t.me && <em> · you</em>}</b>
                            <small>{t.points.toLocaleString()} pts</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}
          <p className="bp-fair">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
            Fair play: false reports cost points, and rewards are only paid once a report is confirmed. Investigators never share who reported. <a href="/verify">Check a product code</a>
          </p>
        </main>
      </div>
    </DashShell>
  );
}
