"use client";
import { useState } from "react";

// The stats line and "Follow" button of the public studio page (Figma 597:27). They share the
// follower count, so they live together; CSS grid areas place them in the header.
const n = (v: number) => v.toLocaleString("en-GB");

export default function FollowStudio({ slug, following: f0, followers: n0, premieres, countries, website, signedIn }: {
  slug: string; following: boolean; followers: number; premieres: number; countries: number; website: string; signedIn: boolean;
}) {
  const [following, setFollowing] = useState(f0);
  const [followers, setFollowers] = useState(n0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function toggle() {
    if (!signedIn) { window.location.href = `/signin?next=/studios/${slug}`; return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/studios/${slug}/follow`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: !following }) });
      const j = (await r.json().catch(() => ({}))) as { following?: boolean; followers?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? "Something went wrong");
      setFollowing(Boolean(j.following)); setFollowers(j.followers ?? followers);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const stats = [`${n(followers)} ${followers === 1 ? "follower" : "followers"}`, `${n(premieres)} ${premieres === 1 ? "premiere" : "premieres"}`];
  if (countries) stats.push(`seen in ${n(countries)} ${countries === 1 ? "country" : "countries"}`);
  return (
    <>
      <p className="sp-stats" aria-live="polite">{stats.join("  ·  ")}</p>
      <div className="sp-acts">
        <button type="button" className={`lp-btn${following ? " ghost" : ""}`} aria-pressed={following} disabled={busy} onClick={() => void toggle()}>{following ? "Following" : "Follow"}</button>
        {website && <a className="lp-btn ghost" href={website} target="_blank" rel="noopener noreferrer nofollow">Website</a>}
        {err && <p className="vf-err" role="alert">{err}</p>}
      </div>
    </>
  );
}
