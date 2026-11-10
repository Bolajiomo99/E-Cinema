import Link from "next/link";
import { cookies } from "next/headers";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import StudentVerify, { type StudentStatus } from "@/components/student/StudentVerify";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { readLocale } from "@/lib/locale";
import { countryName, currencyFor, money, priceOf } from "@/lib/plans";

// Built from the Figma frame "Web / Student offer" (94:1327).
export const dynamic = "force-dynamic";
export const metadata = { title: "Student offer · E-Cinema", description: "Student Pro: every premiere and member prices for less than half the Pro price. Verify once a year." };

export default async function StudentPage() {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  let status: StudentStatus = { verified: false };
  let country = loc.country;
  if (me && session) {
    const [s, p] = await Promise.all([accountApi("GET", "/v1/me/student", undefined, session).catch(() => null), accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null)]);
    if (s?.status === 200) status = s.body as StudentStatus;
    country = (p?.status === 200 ? (p.body as { country?: string }).country : undefined) || country;
  }
  const cur = currencyFor(country);
  const student = priceOf("student", cur), pro = priceOf("pro", cur);
  const save = Math.round((1 - student / pro) * 100);
  const where = countryName(country);

  const body = (
    <div className="lp gf sdp">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <header className="sd-hero">
        <div className="gf-copy">
          <p className="gf-eyebrow">STUDENT OFFER</p>
          <h1>HALF PRICE PRO FOR STUDENTS.</h1>
          <p className="lp-body-l">Every premiere, member prices on seats and Pro features for {money(student, cur)} a month instead of {money(pro, cur)}{where ? ` in ${where}` : ""}. Verify once a year with your student email or ID.</p>
          <div><a href="#verify" className="lp-btn">Verify and save {save}%</a></div>
        </div>
      </header>
      <main id="main">
        <section className="gf-main">
          <h2>How to get it</h2>
          <ol className="sd-steps">
            <li><b>1</b><h3>Verify you study</h3><p>Student email, or a photo of your student ID checked by AI in seconds.</p></li>
            <li><b>2</b><h3>Pick Student Pro</h3><p>{money(student, cur)} a month{where ? ` in ${where}` : ""}. Prices follow your country.</p></li>
            <li><b>3</b><h3>Watch with classmates</h3><p>Start a watch party for your class and watch premieres together.</p></li>
          </ol>
        </section>
        <section className="gf-main" id="verify">
          <h2>Verify now</h2>
          {me ? <StudentVerify initial={status} price={money(student, cur)} /> : (
            <div className="sd-form">
              <p className="gf-note">Sign in or join free first, so the discount lands on your account.</p>
              <div className="gf-actions"><Link href="/join?next=%2Fstudent%23verify" className="lp-btn md">Join free</Link><Link href="/signin?next=%2Fstudent%23verify" className="lp-btn md secondary">Sign in</Link></div>
            </div>
          )}
        </section>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
