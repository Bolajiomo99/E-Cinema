import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LandingFooter from "@/components/landing/LandingFooter";
import { currentAccount } from "@/lib/auth";
import { PLANS, naira } from "@/lib/licensing-types";
import { readLocale } from "@/lib/locale";

// The merch licence agreement partners accept when they pay ("Read the full licence agreement", Figma 116:726).
export const metadata = { title: "Merch licence agreement · E-Cinema" };

const TERMS: [string, string][] = [
  ["Who this is between", "Online Cinema Ltd, trading as E‑Cinema (RC 9947766), and the company named on the licence. The licence starts when the fee is paid and runs for one year."],
  ["What you may do", "Make and sell the products E‑Cinema has approved, carrying the E‑CINEMA wordmark, in the countries named on your licence. Film artwork may only be used on products approved for that film."],
  ["Approval first", "Every product, colour and print needs approval in your partner dashboard before it is sold. A printed sample photo is due before each product goes on sale. Changes to an approved product need a new approval."],
  ["Labels", "Every item carries its own E‑Cinema QR label. Labels are issued only for approved products, may not be copied or moved to another product, and stay the property of E‑Cinema."],
  ["Prices and selling", "You set your own prices. Selling outside your licensed countries, or through anyone who is not on your licence, is not allowed. Online sales count where the buyer is."],
  ["Fees and royalties", `The yearly fee depends on the plan (Starter ${naira(PLANS[0].feeNgn)}, Growth ${naira(PLANS[1].feeNgn)}, Global agreed with us). A royalty of ${PLANS.map((p) => `${p.royaltyPct}% on ${p.name}`).join(", ")} is due on each month's sales by the 5th of the next month. Sales must be reported honestly; we may check records once a year with notice.`],
  ["Sales in the E‑Cinema shop", "Growth and Global products can be listed in the E‑Cinema shop. We pay you the shop sales, less your royalty, on the 15th of the next month into your verified payout account."],
  ["Quality and safety", "Products must be safe, legal and of the quality shown in your approved sample. We may buy items in the market to check them."],
  ["Fakes", "Tell us about copies you find; our investigators and community act on reports in your market. Never take legal action in E‑Cinema's name without our written agreement."],
  ["Ending the licence", "Either side may end the licence with 30 days' written notice for a serious breach that is not fixed in that time. Once it ends, stop making products, sell remaining approved stock within 60 days, and return or destroy unused labels."],
  ["Personal data", "Buyer details you send us are used only to count repeat buyers and are stored as a code, not as phone numbers or emails. See the privacy policy."],
  ["Law", "This agreement is governed by the laws of the Federal Republic of Nigeria. Questions: admin@e-cinema.net."],
];

export default async function AgreementPage() {
  const [me, loc] = await Promise.all([currentAccount(), readLocale()]);
  const body = (
    <div className="lp li">
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <main id="main" className="li-guide">
        <p className="lp-eyebrow">LICENSING</p>
        <h1>Merch licence agreement</h1>
        <ol className="li-terms">{TERMS.map(([t, d]) => <li key={t}><b>{t}</b><p>{d}</p></li>)}</ol>
        <a className="lp-btn" href="/licensing/apply">Apply for a licence</a>
      </main>
      <LandingFooter />
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
