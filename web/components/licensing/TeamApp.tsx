"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dateName, type Member } from "@/lib/licensing-types";
import { pcall } from "./pcall";

export default function TeamApp({ members, owner }: { members: Member[]; owner: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  async function act(body: { email: string; remove?: boolean }) {
    setBusy(body.email); setErr(""); setMsg("");
    try {
      await pcall("POST", "partner/members", body);
      setMsg(body.remove ? `${body.email} no longer has access.` : `${body.email} added. They get access when they sign in to E‑Cinema with that email.`);
      setEmail("");
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  }
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Team</h1>
          <p>People at your company who can see sales, submit products and order labels</p>
        </div>
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      <section className="bp-panel">
        <h2>Members</h2>
        {members.map((m) => (
          <div key={m.email} className="pt-v">
            <span className="pt-av" aria-hidden>{(m.name || m.email).slice(0, 2).toUpperCase()}</span>
            <div><b>{m.name || m.email}</b><small>{m.name ? `${m.email} · ` : ""}{m.joined ? `added ${dateName(m.addedAt)}` : "invited · not signed in yet"}</small></div>
            <span className={`bp-pill ${m.role === "owner" ? "teal" : "grey"}`}>{m.role === "owner" ? "Owner" : "Staff"}</span>
            {owner && m.role !== "owner" && <button className="vf-btn soft sm" disabled={!!busy} onClick={() => act({ email: m.email, remove: true })}>{busy === m.email ? "Removing" : "Remove"}</button>}
          </div>
        ))}
      </section>
      {owner ? (
        <section className="bp-panel">
          <h2>Add someone</h2>
          <form className="pt-inline" onSubmit={(e) => { e.preventDefault(); act({ email }); }}>
            <label className="vf-field"><span>Work email</span><div className="vf-box"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sales@yourcompany.ng" maxLength={120} /></div></label>
            <button className="vf-btn red" disabled={!!busy}>{busy && busy === email ? "Adding" : "Add to team"}</button>
          </form>
          <p className="pt-hint">Staff can do everything except change the payout account, renew the licence or manage the team. Up to 25 people.</p>
          {err && <p className="vf-err" role="alert">{err}</p>}
        </section>
      ) : err && <p className="vf-err" role="alert">{err}</p>}
    </div>
  );
}
