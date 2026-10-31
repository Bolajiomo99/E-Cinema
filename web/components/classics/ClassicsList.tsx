"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Classic } from "@/lib/classics";

// The list and vault search from Figma "Web / Request a classic" (31:1055).
export default function ClassicsList({ items, canRequest, signedIn }: { items: Classic[]; canRequest: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((c) => `${c.title} ${c.year ?? ""}`.toLowerCase().includes(t)) : items;
  }, [q, items]);

  const call = async (url: string, method: string, body?: unknown) => {
    setMsg("");
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(b.error ?? "Something went wrong. Try again."); return false; }
    router.refresh();
    return true;
  };
  const vote = async (c: Classic) => {
    setBusy(c.id);
    await call(`/api/classics/${c.id}`, c.mine ? "DELETE" : "POST");
    setBusy("");
  };
  const suggest = async () => {
    const m = q.trim().match(/^(.*?)(?:\s*\(?((?:19|20)\d{2})\)?)?$/);
    setBusy("new");
    if (await call("/api/classics", "POST", { title: m?.[1] ?? q, year: m?.[2] ? Number(m[2]) : 0 })) setQ("");
    setBusy("");
  };

  return (
    <>
      <label className="cl-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the studio vaults, or type a title and year to suggest one" aria-label="Search classics" />
      </label>
      {msg && <p className="wp-err" role="alert">{msg}{!canRequest && signedIn && <> <Link href="/plans">See plans</Link></>}</p>}
      {!signedIn && <p className="cl-note"><Link href="/signin?next=/classics">Sign in</Link> with a Pro or Enterprise plan to add your request.</p>}
      {signedIn && !canRequest && <p className="cl-note">You can follow every request. Adding yours needs Pro or Enterprise. <Link href="/plans">See plans</Link></p>}
      <ul className="cl-list">
        {shown.map((c) => {
          const pct = Math.min(100, Math.round((c.requests / c.goal) * 100));
          const reached = c.requests >= c.goal;
          return (
            <li key={c.id} className="cl-item">
              <span className="cl-poster" style={{ background: `linear-gradient(180deg, ${c.colors[0]} 0%, ${c.colors[1] ?? "#000"} 60%, #000 100%)` }}><b>{c.title.toUpperCase()}</b></span>
              <div className="cl-t">
                <div className="cl-h"><strong>{c.title.toUpperCase()}{c.year ? ` (${c.year})` : ""}</strong><span className="lp-badge outline">{c.fromVault ? "FROM STUDIO VAULT" : "SUGGESTED BY MEMBERS"}</span></div>
                <span className="cl-bar"><span style={{ width: `${pct}%` }} /></span>
                <small>{c.requests.toLocaleString("en-US")} of {c.goal.toLocaleString("en-US")} requests · {reached ? (c.showtimeId ? "screening scheduled" : "the studio is scheduling a night") : `screens one night when it reaches ${c.goal}`}</small>
              </div>
              {c.showtimeId ? <Link href={`/checkout?film=${c.showtimeId}`} className="cl-btn">Get a seat</Link>
                : <button type="button" className={`cl-btn${c.mine ? " on" : ""}`} disabled={busy === c.id || (!c.mine && (!signedIn || !canRequest))} onClick={() => vote(c)}>{c.mine ? "Requested ✓" : "Request"}</button>}
            </li>
          );
        })}
        {q.trim() && (
          <li className="cl-item cl-new">
            <div className="cl-t"><strong>Not in the list?</strong><small>Suggest &ldquo;{q.trim()}&rdquo;. We ask the rights holder once members show enough interest.</small></div>
            <button type="button" className="cl-btn" disabled={busy === "new" || !canRequest || q.trim().length < 2} onClick={suggest}>Suggest it</button>
          </li>
        )}
      </ul>
    </>
  );
}
