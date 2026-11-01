"use client";
import { useState } from "react";
import { initials } from "./StudioShell";
import { dayName, ROLE_HELP, ROLE_NAMES, type Member, type Role } from "@/lib/studio-types";
import { scall } from "./scall";

// Figma "Studio / Team and roles" (39:980): the people at the studio, their roles, and what each
// role is allowed to do (the same rules the API enforces).
const ROLES: Role[] = ["owner", "admin", "finance", "marketing", "viewer"];
const PILL: Record<Role, string> = { owner: "gold", admin: "teal", finance: "purple", marketing: "amber", viewer: "grey" };
const MATRIX: [string, Role[]][] = [
  ["See films, audiences and ratings", ["owner", "admin", "finance", "marketing", "viewer"]],
  ["Edit studio details and settings", ["owner", "admin"]],
  ["See revenue, statements and payouts", ["owner", "admin", "finance"]],
  ["Change the payout account", ["owner", "admin", "finance"]],
  ["Invite people and change roles", ["owner", "admin"]],
  ["Make someone an owner", ["owner"]],
];

export default function StudioTeam({ initial, myRole }: { initial: Member[]; myRole: Role }) {
  const [members, setMembers] = useState(initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const manage = myRole === "owner" || myRole === "admin";
  const assignable = ROLES.filter((r) => r !== "owner" || myRole === "owner");

  async function act(tag: string, fn: () => Promise<{ members: Member[] }>, done: string) {
    setBusy(tag); setErr(""); setMsg("");
    try {
      const r = await fn();
      setMembers(r.members);
      setMsg(done);
      return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(""); }
  }

  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Team and roles</h1>
          <p>{members.length} {members.length === 1 ? "member" : "members"} · everyone signs in with their own E‑Cinema account</p>
        </div>
        {manage && <button className="vf-btn red" onClick={() => setInviting((v) => !v)} aria-expanded={inviting}>{inviting ? "Close" : "Invite member"}</button>}
      </header>
      {msg && <p className="bp-flash" role="status">{msg}</p>}
      {inviting && manage && (
        <section className="bp-panel">
          <h2>Invite someone</h2>
          <form className="pt-inline" onSubmit={async (e) => {
            e.preventDefault();
            const ok = await act("invite", () => scall("PUT", "team", { email: email.trim(), role }), `${email.trim()} can now open the studio portal as ${ROLE_NAMES[role].toLowerCase()} once they sign in with that email.`);
            if (ok) { setEmail(""); setRole("viewer"); setInviting(false); }
          }}>
            <label className="vf-field"><span>Work email</span><div className="vf-box"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} placeholder="colleague@yourstudio.com" /></div></label>
            <label className="vf-field"><span>Role</span><div className="vf-box"><select value={role} onChange={(e) => setRole(e.target.value as Role)}>{assignable.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></div></label>
            <button className="vf-btn red" disabled={busy === "invite"}>{busy === "invite" ? "Adding" : "Add to team"}</button>
          </form>
          <p className="pt-hint">{ROLE_HELP[role]}. Up to 50 people.</p>
        </section>
      )}
      {err && <p className="vf-err" role="alert">{err}</p>}

      <section className="bp-panel">
        <h2>Members</h2>
        <div className="stu-tm" role="table" aria-label="Members">
          <div className="stu-tr hdr" role="row"><span role="columnheader">Member</span><span role="columnheader">Role</span><span role="columnheader">Since</span><span /></div>
          {members.map((m) => (
            <div key={m.email} className="stu-tr" role="row">
              <span role="cell" className="stu-who"><i className="pt-av" aria-hidden>{initials(m.name || m.email)}</i><span><b>{m.name || m.email}{m.me ? " (you)" : ""}</b><small>{m.email}</small></span></span>
              <span role="cell">
                {manage && !m.me && (m.role !== "owner" || myRole === "owner") ? (
                  <select className="stu-role" aria-label={`Role for ${m.email}`} value={m.role} disabled={!!busy} onChange={(e) => act(m.email, () => scall("PUT", "team", { email: m.email, role: e.target.value }), `${m.email} is now ${ROLE_NAMES[e.target.value as Role].toLowerCase()}.`)}>
                    {assignable.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                  </select>
                ) : <span className={`bp-pill ${PILL[m.role]}`}>{ROLE_NAMES[m.role]}</span>}
              </span>
              <span role="cell" className="stu-mut">{m.joined ? dayName(m.addedAt) : "Invited · not signed in yet"}</span>
              <span role="cell">
                {manage && !m.me && (m.role !== "owner" || myRole === "owner") && (
                  <button className="vf-btn sm" disabled={!!busy} onClick={() => act(m.email, () => scall("POST", "team/remove", { email: m.email }), `${m.email} no longer has access.`)}>{busy === m.email ? "Saving" : "Remove"}</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="bp-panel">
        <h2>What each role can do</h2>
        <div className="stu-mx" role="table" aria-label="Role permissions">
          <div className="stu-mr hdr" role="row"><span role="columnheader">Permission</span>{ROLES.map((r) => <span key={r} role="columnheader">{ROLE_NAMES[r]}</span>)}</div>
          {MATRIX.map(([what, who]) => (
            <div key={what} className="stu-mr" role="row">
              <span role="cell">{what}</span>
              {ROLES.map((r) => <span key={r} role="cell" aria-label={who.includes(r) ? "Yes" : "No"}>{who.includes(r) ? "●" : ""}</span>)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
