"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import FaceCheck from "@/components/FaceCheck";
import { monthName, type Statement } from "@/lib/licensing-types";
import { pcall, saveCsv } from "./pcall";

export function StatementCsv({ licence, pct, rows }: { licence: string; pct: number; rows: Statement[] }) {
  return (
    <button className="vf-btn soft" disabled={!rows.length} onClick={() => saveCsv(`e-cinema-statement-${licence}.csv`, [
      ["Licence", licence], [],
      ["Month", "Your sales (NGN)", `Royalty ${pct}% (NGN)`, "E-Cinema shop sales paid to you (NGN)", "Status"],
      ...rows.map((r) => [monthName(r.month), r.salesNgn, r.royaltyNgn, r.shopNgn, r.status]),
    ])}>Download statement</button>
  );
}

// Changing where money goes needs the director's face check and starts a 48-hour hold, so a
// stolen login cannot redirect payouts.
export function PayoutChange({ owner, identityOk, has, company }: { owner: boolean; identityOk: boolean; has: boolean; company: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ok, setOk] = useState(identityOk);
  const [f, setF] = useState({ bank: "", number: "", name: company });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <div className="pt-v">
        <div><b>{has ? "Change payout account" : "Add payout account"}</b><small>{owner ? "Needs director face check and a 48-hour hold" : "Only the licence owner can change this"}</small></div>
        {owner && <button className="vf-btn soft sm" onClick={() => setOpen((o) => !o)}>{open ? "Close" : has ? "Change" : "Add"}</button>}
      </div>
      {open && (
        <div className="pt-form">
          {!ok ? <FaceCheck onVerified={() => setOk(true)} /> : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true); setErr("");
              try { await pcall("PUT", "partner/payout", f); setOpen(false); router.refresh(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
            }}>
              <div className="ap-row">
                <label className="vf-field"><span>Bank</span><div className="vf-box"><input required value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} placeholder="Zenith Bank" maxLength={60} /></div></label>
                <label className="vf-field"><span>Account number</span><div className="vf-box"><input required inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} placeholder="10 digits" maxLength={34} /></div></label>
              </div>
              <label className="vf-field"><span>Account name</span><div className="vf-box"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></div></label>
              {err && <p className="vf-err" role="alert">{err}</p>}
              <div className="ap-act"><span /><button className="vf-btn red" disabled={busy}>{busy ? "Saving" : "Save account"}</button></div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
