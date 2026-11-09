"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ContentData } from "@/lib/exec";
import { dubName } from "@/lib/dub-types";
import { countryName } from "@/lib/worldmap";

// Content and studios (Figma 82:633). Studios run themselves; this is the platform view, with
// approving studios the desk already checked and inviting new ones.
type Film = ContentData["films"][number] & { type: string };
const k = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US"));

export default function ExecContent({ c, canApprove, now }: { c: Omit<ContentData, "films"> & { films: Film[] }; canApprove: boolean; now: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [invite, setInvite] = useState<{ email: string; studio: string; note: string } | null>(null);
  const [all, setAll] = useState(false);
  const films = all ? c.films : c.films.filter((f) => f.state !== "ended").slice(0, 12);

  async function approve(slug: string, name: string) {
    setBusy(slug); setMsg(null);
    const r = await fetch(`/api/executive/studios/${slug}/approve`, { method: "POST" });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    setBusy("");
    if (r.ok) { setMsg({ ok: true, text: `${name} is verified and can upload films now.` }); router.refresh(); }
    else setMsg({ ok: false, text: j.error || "That did not go through. Try again." });
  }
  async function sendInvite() {
    if (!invite) return;
    setBusy("invite"); setMsg(null);
    const r = await fetch("/api/executive/invite-studio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invite) });
    const j = await r.json().catch(() => ({}));
    setBusy("");
    if (r.ok) { setMsg({ ok: true, text: `Invite sent to ${invite.email.trim().toLowerCase()}.` }); setInvite(null); }
    else setMsg({ ok: false, text: j.error || "The invite did not send." });
  }
  const status = (f: Film) => {
    if (f.state === "screening") return <span className="exn-st ok">Screening</span>;
    if (f.state === "presale") return <span className="exn-st soon">Pre-sale · {Math.max(1, Math.ceil((Date.parse(f.starts) - now) / 86400000))} days</span>;
    if (f.state === "waiting") return <span className="exn-st wait">Waiting for a premiere date</span>;
    return <span className="exn-st done">Ended</span>;
  };
  const why = (p: ContentData["pending"][number]) => [p.hasDocs ? (p.docsOk ? "Documents checked" : "Documents waiting for the desk") : "No documents yet", p.rights ? "rights accepted" : "rights not accepted", p.hasBank ? "" : "payout details pending"].filter(Boolean).join(" · ");

  return (
    <section className="exc exn">
      <header className="exc-head">
        <div>
          <h1>Content and studios</h1>
          <p className="exc-sub">Every film on E-Cinema, the studios behind them, and what is waiting for approval. Studios self-serve; this is the platform view.</p>
        </div>
        <button className="exa-red" onClick={() => { setMsg(null); setInvite({ email: "", studio: "", note: "" }); }}>Invite a studio</button>
      </header>

      <div className="exc-tiles exg-tiles">
        <div className="exc-tile"><span>Films screening</span><b>{k(c.screening)}</b><small className="up">{c.countries ? `in ${c.countries} countr${c.countries === 1 ? "y" : "ies"}` : "no ticket buyers yet"}</small></div>
        <div className="exc-tile"><span>Studios</span><b>{k(c.studios)}</b><small className={c.studiosWaiting ? "warn" : ""}>{c.studiosWaiting} waiting to be verified</small></div>
        <div className="exc-tile"><span>Coming soon</span><b>{k(c.preSales)}</b><small className="up">pre-sales open · {c.comingSoon} with a coming-soon post</small></div>
        <div className="exc-tile"><span>Avg rating</span><b>{c.reviews ? c.rating.toFixed(1) : "–"}</b><small className={c.reviews ? "up" : ""}>{c.reviews ? `from ${k(c.reviews)} reviews` : "no reviews yet"}</small></div>
      </div>

      {msg && <p className={`exa-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}

      <div className="exc-card exn-films">
        <div className="exc-card-h"><h2>Films</h2>{c.films.some((f) => f.state === "ended") && <button className="exa-edit" onClick={() => setAll(!all)}>{all ? "Hide ended" : "Show ended too"}</button>}</div>
        <div className="exn-table" role="table" tabIndex={0} aria-label="Films">
          <div className="exn-th" role="row"><span role="columnheader">Title</span><span role="columnheader">Studio</span><span role="columnheader">Type</span><span role="columnheader">Countries</span><span role="columnheader">Tickets</span><span role="columnheader">Status</span></div>
          {films.map((f) => (
            <div key={f.film + f.studio + f.state} className="exn-tr" role="row">
              <span role="cell"><b>{f.showtime ? <Link href={`/film/${f.showtime}`}>{f.film}</Link> : f.film}</b></span>
              <span role="cell">{f.studio}</span><span role="cell">{f.type || "–"}</span>
              <span role="cell">{f.countries || "–"}</span><span role="cell">{f.seats ? k(f.seats) : "—"}</span>
              <span role="cell">{status(f)}</span>
            </div>
          ))}
          {!films.length && <p className="exc-empty">No films yet.</p>}
        </div>
      </div>

      <div className="exc-row exn-row">
        <div className="exc-card">
          <h2>Studios waiting to be verified</h2>
          {c.pending.length ? c.pending.map((p) => (
            <div key={p.slug} className="exn-pend">
              <div><b>{p.name}{p.city || p.country ? `, ${p.city || countryName(p.country)}` : ""}</b><small>{why(p)}</small></div>
              <span>
                <Link href="/studio/desk" className="exa-edit exn-btn">Review</Link>
                {canApprove && <button className="exa-red exn-btn" disabled={!p.docsOk || !p.rights || busy === p.slug} title={!p.docsOk || !p.rights ? "The desk checks documents and rights first" : undefined} onClick={() => approve(p.slug, p.name)}>Approve</button>}
              </span>
            </div>
          )) : <p className="exc-empty">No studio is waiting.</p>}
        </div>
        <div className="exc-card">
          <h2>AI dubbing queue</h2>
          {c.dubs.length ? (
            <div className="exg-plans exn-dubs">
              {c.dubs.map((d) => (
                <div key={d.lang} title={`${d.approved} live, ${d.working} in progress${d.failed ? `, ${d.failed} failed` : ""}`}>
                  <span>{dubName(d.lang)}</span><i><b style={{ width: `${Math.round((d.approved / Math.max(1, d.total)) * 100)}%`, background: "#2bb3a3" }} /></i><strong>{Math.round((d.approved / Math.max(1, d.total)) * 100)}%</strong>
                </div>
              ))}
            </div>
          ) : <p className="exc-empty">No dubs requested yet.</p>}
          <p className="exm-note">Share of each language&apos;s dubs that studios approved. Studios approve every dub line before it goes live.</p>
        </div>
      </div>

      {invite && (
        <div className="exa-scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) setInvite(null); }}>
          <form className="exa-dialog exa" role="dialog" aria-modal="true" aria-labelledby="exn-it" onSubmit={(e) => { e.preventDefault(); sendInvite(); }}>
            <div className="exa-dh"><h2 id="exn-it">Invite a studio</h2></div>
            <p className="exa-dp">They get an email with what E-Cinema offers studios (70% of ticket sales, payouts after each screening) and a link to set up their studio.</p>
            <div className="exa-grid">
              <label>Studio name<input value={invite.studio} maxLength={80} onChange={(e) => setInvite({ ...invite, studio: e.target.value })} placeholder="Studio or company" /></label>
              <label>Email<input type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="name@studio.com" /></label>
            </div>
            <label className="exa-full">A note from you (optional)<textarea className="exn-note" maxLength={400} value={invite.note} onChange={(e) => setInvite({ ...invite, note: e.target.value })} /></label>
            <div className="exa-dact">
              <button type="button" className="exa-ghost" onClick={() => setInvite(null)}>Cancel</button>
              <button className="exa-red" disabled={busy === "invite"}>Send invite</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
