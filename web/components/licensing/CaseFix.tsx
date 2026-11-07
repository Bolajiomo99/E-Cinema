"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pcall } from "./pcall";

// "I have fixed this" on a compliance case (email 43): the brand team then checks and closes it.
export default function CaseFix({ id, fixed }: { id: number; fixed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open) return <button className="vf-btn soft sm" onClick={() => setOpen(true)}>{fixed ? "Update what you changed" : "I have fixed this"}</button>;
  return (
    <form className="pt-fix" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setErr("");
      try { await pcall("POST", `partner/cases/${id}/fixed`, { note }); setOpen(false); router.refresh(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      <label className="vf-field"><span>What did you change?</span><textarea required maxLength={600} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Every cap at the Kano stall now has its E-Cinema code." /></label>
      {err && <p className="vf-err" role="alert">{err}</p>}
      <div className="ap-act"><button className="vf-btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="vf-btn red" disabled={busy}>{busy ? "Sending…" : "Send to the brand team"}</button></div>
    </form>
  );
}
