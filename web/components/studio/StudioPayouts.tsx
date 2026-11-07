"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCsv } from "@/components/licensing/pcall";
import { change, dayName, money, monthLabel, type Film, type PayoutRow, type Studio } from "@/lib/studio-types";
import { scall } from "./scall";
import BankPayoutForm from "./BankPayoutForm";

const CC: Record<string, string> = { NGN: "NG", GHS: "GH", KES: "KE", UGX: "UG", TZS: "TZ", ZAR: "ZA" };

// Figma "Studio / Revenue and payouts" (39:349): what is owed, what is still on sale, what was
// paid, the monthly split, where the money goes and the statement for every ended premiere.
const STATUS: Record<string, [string, string]> = {
  sent: ["teal", "Paid"], pending: ["amber", "Sending"], failed: ["red", "Retrying"], nothing_due: ["grey", "No sales"], owed: ["gold", "Owed"],
};

export default function StudioPayouts({ studio: s, rows, films, months, canMoney }: {
  studio: Studio; rows: PayoutRow[]; films: Film[]; months: { month: string; grossCents: number }[]; canMoney: boolean;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<"" | "paypal" | "bank">("");
  const [email, setEmail] = useState(s.payoutEmail.startsWith("payouts+") ? "" : s.payoutEmail);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const share = s.shareBps / 10000;
  const paidIds = new Set(rows.map((r) => r.showtimeId));
  const owed = films.filter((f) => f.state === "ended" && f.payout !== "sent" && f.payout !== "nothing_due");
  const owedCents = owed.reduce((a, f) => a + f.shareCents, 0);
  const pendingCents = films.filter((f) => f.state !== "ended").reduce((a, f) => a + f.shareCents, 0);
  const year = new Date().getUTCFullYear();
  const paidYear = rows.filter((r) => r.status === "sent" && new Date(r.updatedAt).getUTCFullYear() === year).reduce((a, r) => a + r.studioCents, 0);
  const paidLastYear = rows.filter((r) => r.status === "sent" && new Date(r.updatedAt).getUTCFullYear() === year - 1).reduce((a, r) => a + r.studioCents, 0);
  const yoy = change(paidYear, paidLastYear);
  const statement = [
    ...owed.filter((f) => !paidIds.has(f.showtimeId)).map((f) => ({ id: f.showtimeId, film: f.film, when: f.startsAt, currency: f.currency, gross: f.grossCents, mine: f.shareCents, status: "owed", paid: "" })),
    ...rows.map((r) => ({ id: r.showtimeId, film: r.film, when: r.startsAt, currency: r.currency, gross: r.grossCents, mine: r.studioCents, status: r.status,
      paid: r.method === "bank" && r.paidMinor && r.paidCurrency ? `${money(r.paidMinor, r.paidCurrency)} to bank` : r.method === "bank" ? "bank transfer" : "" })),
  ];
  const six = months.slice(-6);
  const max = Math.max(1, ...six.map((m) => m.grossCents));
  const hasPaypal = s.payoutMethod === "paypal" && s.payoutEmail && !s.payoutEmail.startsWith("payouts+");
  const hasBank = s.payoutMethod === "bank" && Boolean(s.payoutBankCode && s.payoutNumber);
  const hasAccount = hasPaypal || hasBank;
  const last4 = s.payoutNumber ? s.payoutNumber.replace(/\s/g, "").slice(-4) : "";

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try {
      await scall("PUT", "payout", { method: "paypal", email: email.trim(), currency: "USD" });
      setMsg("Payout account saved. It is used from the next payout.");
      setEdit("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Revenue and payouts</h1>
          <p>You keep {s.shareBps / 100}% of net ticket revenue. Your share is sent automatically after each premiere ends.</p>
        </div>
        <button className="vf-btn" disabled={!statement.length} onClick={() => saveCsv(`${s.slug}-statement.csv`, [
          ["Film", "Premiere", "Currency", "Gross", `Platform ${100 - s.shareBps / 100}%`, `Your ${s.shareBps / 100}%`, "Status", "Paid to bank"],
          ...statement.map((r) => [r.film, r.when.slice(0, 10), r.currency, (r.gross / 100).toFixed(2), ((r.gross - r.mine) / 100).toFixed(2), (r.mine / 100).toFixed(2), STATUS[r.status]?.[1] ?? r.status, r.paid]),
        ])}>Download statement</button>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}

      <div className="bp-kpis">
        <div className="bp-kpi"><span>Available to pay out</span><b>{money(owedCents, "USD", true)}</b><em className="muted">{owedCents ? (hasAccount ? "sending as premieres end" : "add a payout account") : "nothing owed now"}</em></div>
        <div className="bp-kpi"><span>Pending (still on sale)</span><b>{money(pendingCents, "USD", true)}</b><em className="muted">clears when each premiere ends</em></div>
        <div className="bp-kpi"><span>Paid this year</span><b>{money(paidYear, "USD", true)}</b><em className={yoy.up ? "" : "neg"}>{paidLastYear ? yoy.text.replace("last month", "last year") : `${rows.filter((r) => r.status === "sent").length} payouts`}</em></div>
        <div className="bp-kpi"><span>Withholding tax</span><b>–</b><em className="muted">Tax filing <span className="soon-tag">Soon</span></em></div>
      </div>

      <div className="pt-row a">
        <section className="bp-panel">
          <h2>Monthly split</h2>
          {six.some((m) => m.grossCents) ? (
            <div className="stu-split-chart" role="img" aria-label="Studio and E-Cinema share of each month's ticket revenue">
              {six.map((m) => (
                <div key={m.month} title={`${money(m.grossCents * share)} studio · ${money(m.grossCents * (1 - share))} E-Cinema`}>
                  <i style={{ height: `${(m.grossCents / max) * 170}px` }}><em style={{ height: `${(1 - share) * 100}%` }} /></i>
                  <span>{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
          ) : <p className="pt-empty">Each month&apos;s split shows here from your first ticket sale.</p>}
          <div className="stu-key"><span><i className="a" />Studio {s.shareBps / 100}%</span><span><i className="b" />E‑Cinema {100 - s.shareBps / 100}%</span></div>
        </section>
        <section className="bp-panel">
          <h2>Payout accounts</h2>
          <div className={`stu-acc${hasBank ? " dim" : ""}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#a6a6b0" strokeWidth="1.6" aria-hidden><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></svg>
            <div><b>{hasPaypal ? `PayPal ${s.payoutEmail}` : "PayPal"}</b><small>{hasPaypal ? "USD · default · after each premiere" : "US dollars to a PayPal account"}</small></div>
            {canMoney && !edit && <button type="button" className="vf-btn sm ghost" onClick={() => setEdit("paypal")}>{hasPaypal ? "Change" : hasBank ? "Use" : "Add"}</button>}
          </div>
          <div className={`stu-acc${hasPaypal ? " dim" : ""}`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#a6a6b0" strokeWidth="1.6" aria-hidden><path d="M3 10 12 4l9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" /></svg>
            <div><b>{hasBank ? `${s.payoutBank} ···${last4}` : "Bank transfer"}</b><small>{hasBank ? `${s.payoutName} · ${s.payoutCurrency} · default · after each premiere` : "Local currency to a bank account, through Flutterwave"}</small></div>
            {canMoney && !edit && <button type="button" className="vf-btn sm ghost" onClick={() => setEdit("bank")}>{hasBank ? "Change" : hasPaypal ? "Use" : "Add"}</button>}
          </div>
          <div className="stu-acc off"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#6e6e7a" strokeWidth="1.6" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9 9h4.5a1.5 1.5 0 0 1 0 3H9h5a1.5 1.5 0 0 1 0 3H9M11 7v10" /></svg><div><b>USDC wallet <em className="soon-tag">Soon</em></b><small>Optional · on request</small></div></div>
          {canMoney ? (edit === "paypal" ? (
            <form className="pt-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
              <label className="vf-field"><span>PayPal email</span><div className="vf-box"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} placeholder="finance@yourstudio.com" /></div></label>
              <div className="pt-btns"><button className="vf-btn red sm" disabled={busy}>{busy ? "Saving" : "Save"}</button><button type="button" className="vf-btn sm ghost" onClick={() => setEdit("")}>Cancel</button></div>
            </form>
          ) : edit === "bank" ? (
            <BankPayoutForm
              initial={hasBank ? { country: CC[s.payoutCurrency], bankCode: s.payoutBankCode, number: s.payoutNumber, name: s.payoutName } : undefined}
              onCancel={() => setEdit("")}
              onSaved={() => { setMsg("Bank account saved. It is used from the next payout."); setEdit(""); router.refresh(); }}
            />
          ) : null) : <p className="pt-hint">Only the owner, admins and finance can change where money goes.</p>}
          {err && <p className="vf-err" role="alert">{err}</p>}
          <p className="pt-hint">{hasBank ? `Your share is converted to ${s.payoutCurrency} at Flutterwave's transfer rate and sent to your bank after each premiere ends.` : "Payouts are sent in US dollars through PayPal. PayPal converts to your local currency at its rate when you withdraw."}</p>
        </section>
      </div>

      <section className="bp-panel">
        <h2>Statement</h2>
        {statement.length ? (
          <div className="stu-st" role="table" aria-label="Statement">
            <div className="stu-sr hdr" role="row"><span role="columnheader">Film</span><span role="columnheader">Premiere</span><span role="columnheader">Gross</span><span role="columnheader">Platform {100 - s.shareBps / 100}%</span><span role="columnheader">Your {s.shareBps / 100}%</span><span role="columnheader">Status</span></div>
            {statement.map((r) => (
              <div key={r.id} className="stu-sr" role="row">
                <span role="cell"><b>{r.film}</b></span>
                <span role="cell">{dayName(r.when)}</span>
                <span role="cell">{money(r.gross, r.currency)}</span>
                <span role="cell">{money(r.gross - r.mine, r.currency)}</span>
                <span role="cell"><b>{money(r.mine, r.currency)}</b>{r.paid && <small className="stu-paid">{r.paid}</small>}</span>
                <span role="cell"><span className={`bp-pill ${STATUS[r.status]?.[0] ?? "grey"}`}>{STATUS[r.status]?.[1] ?? r.status}</span></span>
              </div>
            ))}
          </div>
        ) : <p className="pt-empty">Statements appear here after your first premiere ends.</p>}
      </section>
    </div>
  );
}
