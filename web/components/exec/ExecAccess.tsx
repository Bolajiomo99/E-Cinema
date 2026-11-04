"use client";
import { useState } from "react";
import type { ExecPerson } from "@/lib/exec";
import { ROLE_LABEL } from "@/lib/exec-types";

// Access and roles (Figma 49:1307): summary cards, the people list with filters, the quick grant
// form, and the grant dialog (99:1041) used for new people and edits alike.
type Group = "all" | "cabinet" | "investors" | "stakeholders" | "partners";
const GROUP: Record<string, Exclude<Group, "all"> | "ceo"> = { ceo: "ceo", cfo: "cabinet", coo: "cabinet", cto: "cabinet", cmo: "cabinet", investor: "investors", stakeholder: "stakeholders", partner: "partners" };
const OFFICER: Record<string, string> = { coo: "Chief Operating Officer", cfo: "Chief Financial Officer", cto: "Chief Technology Officer", cmo: "Chief Marketing Officer" };
const SEES: Record<string, string> = {
  ceo: "Everything", coo: "Operations, live, safety, shop", cfo: "Money, payouts, tax, investors", cto: "Infrastructure, security, AI", cmo: "Growth, marketing, members",
  investor: "Investor view", stakeholder: "Stakeholder view", partner: "Their own deal",
};
const SCOPE: Record<string, string> = { growth: "Growth", revenue: "Revenue", cohorts: "Cohorts", runway: "Runway", personal: "Personal data", recipients: "18+ recipients" };
const DOT: Record<string, string> = { ceo: "#e3182d", cabinet: "#8b7cf6", investors: "#d4a23a", stakeholders: "#2bb3a3", partners: "#4696ff" };
const AV = ["#8b7cf6", "#4696ff", "#2bb3a3", "#d4a23a", "#e3182d", "#ff8c28"];
const label = (p: { role: string }) => (GROUP[p.role] === "cabinet" ? `Cabinet · ${ROLE_LABEL[p.role]}` : ROLE_LABEL[p.role] ?? p.role);
const ini = (p: ExecPerson) => (p.name || p.email).replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${y}`; };

function ago(iso: string | null, now: number) {
  if (!iso) return "Never";
  const m = Math.floor((now - Date.parse(iso)) / 60000);
  if (m < 2) return "Now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  const d = Math.floor(m / 1440);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

type Form = { email: string; name: string; org: string; role: string; scopes: string[]; canAdd: boolean; canMoney: boolean; watermark: boolean; expiresOn: string };
const blank: Form = { email: "", name: "", org: "", role: "investor", scopes: ["growth", "revenue", "cohorts", "runway"], canAdd: false, canMoney: false, watermark: true, expiresOn: "" };

export default function ExecAccess({ initial, now }: { initial: ExecPerson[]; now: number }) {
  const [people, setPeople] = useState(initial);
  const [group, setGroup] = useState<Group>("all");
  const [quick, setQuick] = useState<Form>(blank);
  const [dialog, setDialog] = useState<(Form & { editing: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const count = (g: string) => people.filter((p) => GROUP[p.role] === g).length;
  const shown = people.filter((p) => group === "all" || GROUP[p.role] === group);

  async function reload() {
    const r = await fetch("/api/executive/people");
    if (r.ok) setPeople((await r.json()).people ?? []);
  }
  async function save(f: Form, invite: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/executive/people", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, invite }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: j.error || "That did not save. Try again." }); return false; }
      setMsg({ ok: true, text: j.added ? (j.emailed ? `Access granted. The invite went to ${f.email.trim().toLowerCase()}.` : `Access is waiting. Email is off here, so the one-time invite link could not be sent.`) : "Access changed. It applies on their next page." });
      await reload();
      return true;
    } finally { setBusy(false); }
  }
  async function remove(email: string) {
    if (!window.confirm(`Remove ${email} from every executive page?`)) return;
    setBusy(true);
    const r = await fetch(`/api/executive/people/${encodeURIComponent(email)}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) { setDialog(null); setMsg({ ok: true, text: `${email} no longer has access.` }); await reload(); }
    else setMsg({ ok: false, text: "That did not remove them. Try again." });
  }
  const edit = (p: ExecPerson) => setDialog({ editing: true, email: p.email, name: p.name, org: p.org, role: p.role, scopes: p.scopes, canAdd: p.canAdd, canMoney: p.canMoney, watermark: p.watermark, expiresOn: p.expiresOn });

  const cards = [
    { g: "ceo", t: "CEO", n: "You only", d: "Everything, including 18+ recipients, access, raw money and every audit log" },
    { g: "cabinet", t: "Cabinet", n: plural(count("cabinet"), "person", "people"), d: "Their area in full: operations, money, content, safety, tech. No access control" },
    { g: "investors", t: "Investors", n: plural(count("investors"), "person", "people"), d: "Board pack: growth, revenue, margins, cohorts, runway. No personal data" },
    { g: "stakeholders", t: "Stakeholders", n: plural(count("stakeholders"), "person", "people"), d: "Monthly summaries and the areas you share" },
    { g: "partners", t: "Partners", n: plural(count("partners"), "org", "orgs"), d: "Only their own deal: payments, telcos, studios, merch" },
  ];
  const chips: [Group, string][] = [["all", `All ${people.length}`], ["cabinet", "Cabinet"], ["investors", "Investors"], ["partners", "Partners"]];

  return (
    <section className="exc exa">
      <header className="exc-head">
        <div>
          <h1>Access and roles</h1>
          <p className="exc-sub">Only you can grant, change or remove access. People you add get an invite email, sign in with that address and see everything their role allows at once.</p>
        </div>
        <button className="exa-red" onClick={() => { setMsg(null); setDialog({ ...blank, role: "coo", scopes: [], canAdd: true, editing: false }); }}>Grant access</button>
      </header>

      <div className="exa-cards">
        {cards.map((c) => (
          <div key={c.g} className="exc-card exa-card">
            <div><i style={{ background: DOT[c.g] }} /><b>{c.t}</b><small>{c.n}</small></div>
            <p>{c.d}</p>
          </div>
        ))}
      </div>

      {msg && <p className={`exa-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}

      <div className="exc-card">
        <div className="exc-card-h">
          <h2>People with access</h2>
          <div className="exc-seg" role="group" aria-label="Filter">
            {chips.map(([g, t]) => <button key={g} className={group === g ? "on" : ""} aria-pressed={group === g} onClick={() => setGroup(g)}>{t}</button>)}
          </div>
        </div>
        <div className="exa-table" role="table" aria-label="People with access">
          <div className="exa-th" role="row"><span role="columnheader">Person</span><span role="columnheader">Role</span><span role="columnheader">Can see</span><span role="columnheader">Last active</span><span /></div>
          {shown.map((p, i) => (
            <div key={p.email} className="exa-tr" role="row">
              <span role="cell" className="exa-who"><em style={{ background: p.role === "ceo" ? "#b5101f" : AV[i % AV.length] }}>{ini(p)}</em><span><b>{p.name || p.email.replace(/@.*/, "")}</b><small>{p.org || p.email}</small></span></span>
              <span role="cell" className="exa-role">{label(p)}{p.expired && <small className="exa-exp">Expired</small>}</span>
              <span role="cell">{SEES[p.role]}{p.expiresOn && !p.expired && <small>until {day(p.expiresOn)}</small>}</span>
              <span role="cell">{p.joined ? ago(p.lastActive, now) : "Invited"}</span>
              <span role="cell">{p.role !== "ceo" && <button className="exa-edit" onClick={() => { setMsg(null); edit(p); }}>Edit</button>}</span>
            </div>
          ))}
          {!shown.length && <p className="exc-empty">No one in this group yet.</p>}
        </div>
      </div>

      <div className="exc-row exa-row">
        <form className="exc-card exa-quick" onSubmit={async (e) => { e.preventDefault(); if (await save(quick, false)) setQuick(blank); }}>
          <h2>Grant access</h2>
          <div className="exa-grid">
            <label>Work email<input type="email" required value={quick.email} onChange={(e) => setQuick({ ...quick, email: e.target.value })} placeholder="name@company.com" /></label>
            <label>Role<select value={quick.role} onChange={(e) => setQuick({ ...quick, role: e.target.value })}>
              {Object.keys(ROLE_LABEL).filter((r) => r !== "ceo").map((r) => <option key={r} value={r}>{label({ role: r })}</option>)}
            </select></label>
          </div>
          <div className="exa-chips" role="group" aria-label="What they can see">
            {Object.entries(SCOPE).map(([k, t]) => {
              const on = quick.scopes.includes(k);
              return <button type="button" key={k} className={on ? "on" : ""} aria-pressed={on} onClick={() => setQuick({ ...quick, scopes: on ? quick.scopes.filter((x) => x !== k) : [...quick.scopes, k] })}>{t}</button>;
            })}
          </div>
          <div className="exa-grid">
            <label>Access ends<input type="date" value={quick.expiresOn} onChange={(e) => setQuick({ ...quick, expiresOn: e.target.value })} /></label>
            <label>Watermark exports with name<select value={quick.watermark ? "on" : "off"} onChange={(e) => setQuick({ ...quick, watermark: e.target.value === "on" })}><option value="on">On</option><option value="off">Off</option></select></label>
          </div>
          <button className="exa-red" disabled={busy}>Send invite</button>
        </form>
        <div className="exc-card exa-sec">
          <h2>Security for executive access</h2>
          <ul>
            <li className="ok">Every page checks the role again, so a change applies at once</li>
            <li className="ok">Access ends on the date you set</li>
            <li className="ok">One tap to remove someone everywhere</li>
            <li>Passkey plus face check on every sign-in<em className="soon-tag">Soon</em></li>
            <li>Every view and export logged and watermarked<em className="soon-tag">Soon</em></li>
            <li>An alert when anyone exports data<em className="soon-tag">Soon</em></li>
          </ul>
        </div>
      </div>

      {dialog && (
        <div className="exa-scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          <form className="exa-dialog" role="dialog" aria-modal="true" aria-labelledby="exa-dt" onSubmit={async (e) => { e.preventDefault(); if (await save(dialog, false)) setDialog(null); }}>
            <div className="exa-dh"><h2 id="exa-dt">{dialog.editing ? "Change access" : "Grant access"}</h2><span>CEO only</span></div>
            <p className="exa-dp">{dialog.editing ? "Changes apply on their next page. Removing someone takes them off every executive page at once." : "The person gets an invite email and signs in with that address. There is no public sign-up."}</p>
            <div className="exa-grid">
              <label>Full name<input value={dialog.name} maxLength={80} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} placeholder="Amaka Obi" /></label>
              <label>Work email<input type="email" required readOnly={dialog.editing} value={dialog.email} onChange={(e) => setDialog({ ...dialog, email: e.target.value })} placeholder="name@company.com" /></label>
            </div>
            <span className="exa-lab">Role</span>
            <div className="exa-roles">
              {[{ k: "cabinet", t: "Cabinet", d: "Their area in full" }, { k: "investor", t: "Investor", d: "Read-only growth, money and board pack" }, { k: "stakeholder", t: "Stakeholder", d: "Read-only summary for the board" }, { k: "partner", t: "Partner", d: "Their own deals, payouts and reach" }].map((o) => {
                const on = o.k === "cabinet" ? GROUP[dialog.role] === "cabinet" : dialog.role === o.k;
                return (
                  <div key={o.k} className={`exa-opt${on ? " on" : ""}`}>
                    <button type="button" aria-pressed={on} onClick={() => setDialog({ ...dialog, role: o.k === "cabinet" ? (GROUP[dialog.role] === "cabinet" ? dialog.role : "coo") : o.k })}>
                      <b>{o.k === "cabinet" && on ? `Cabinet · ${OFFICER[dialog.role]}` : o.t}</b><small>{o.d}</small>
                    </button>
                    {o.k === "cabinet" && on && (
                      <select aria-label="Officer" value={dialog.role} onChange={(e) => setDialog({ ...dialog, role: e.target.value })}>
                        {Object.entries(OFFICER).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            {dialog.role === "partner" && <label className="exa-full">Organisation<input value={dialog.org} maxLength={80} onChange={(e) => setDialog({ ...dialog, org: e.target.value })} placeholder="Company name" /></label>}
            <label className="exa-tog"><span><b>Can add merch and rooms</b><small>Cabinet members can create products and rooms themselves</small></span><input type="checkbox" role="switch" checked={dialog.canAdd} onChange={(e) => setDialog({ ...dialog, canAdd: e.target.checked })} /></label>
            <label className="exa-tog"><span><b>Can see money</b><small>Revenue, payouts and costs</small></span><input type="checkbox" role="switch" checked={dialog.canMoney} onChange={(e) => setDialog({ ...dialog, canMoney: e.target.checked })} /></label>
            <label className="exa-full">Access ends<input type="date" value={dialog.expiresOn} onChange={(e) => setDialog({ ...dialog, expiresOn: e.target.value })} /><small>Leave empty for no end date</small></label>
            <div className="exa-dact">
              {dialog.editing && <button type="button" className="exa-rm" disabled={busy} onClick={() => remove(dialog.email)}>Remove access</button>}
              {dialog.editing && <button type="button" className="exa-ghost" disabled={busy} onClick={async () => { if (await save(dialog, true)) setDialog(null); }}>Save and resend invite</button>}
              <button type="button" className="exa-ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button className="exa-red" disabled={busy}>{dialog.editing ? "Save" : "Send invite"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
