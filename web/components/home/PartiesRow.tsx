import Link from "next/link";
import LocalWhen from "@/components/dash/LocalWhen";
import { findShowtime } from "@/lib/catalog";
import type { Party } from "@/lib/parties";

// "Watch parties" row from Figma Home (17:234): the viewer's parties first, then open ones.
export default function PartiesRow({ parties, heroId }: { parties: Party[]; heroId: string }) {
  return (
    <section className="lp-section hm-row" aria-labelledby="hm-parties">
      <div className="hm-row-head">
        <div><h2 id="hm-parties">Watch parties</h2><p>Yours first, then open parties anyone with the link can join.</p></div>
        <Link href={`/parties/new?film=${heroId}`}>Start one</Link>
      </div>
      {parties.length === 0 ? (
        <div className="hm-party empty">
          <div><strong>No parties yet</strong><small>Start one for any premiere, share the link, and watch at the same second as your friends.</small></div>
          <Link href={`/parties/new?film=${heroId}`} className="lp-btn sm">Start a watch party</Link>
        </div>
      ) : (
        <div className="hm-parties">
          {parties.slice(0, 6).map((p) => {
            const s = findShowtime(p.showtimeId);
            const c = s?.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "" };
            const live = s ? Date.parse(s.startsAt) <= Date.now() : false;
            return (
              <Link key={p.code} href={`/p/${p.code}`} className="hm-party">
                <span className="hm-party-poster" style={{ background: `linear-gradient(180deg, ${c.from} 0%, ${c.via} 60%, ${c.to} 100%)` }} />
                <span className="hm-party-t">
                  <strong>{p.name}</strong>
                  <small>{p.members.toLocaleString("en-US")} joined · {live ? "Watching now" : <LocalWhen iso={p.startsAt} />}</small>
                  <span className="hm-party-chips">
                    <span className="lp-badge outline">{p.film.toUpperCase()}</span>
                    {p.joined ? <span className="lp-badge student">{p.isHost ? "HOST" : "JOINED"}</span> : live && <span className="lp-badge live"><i />LIVE</span>}
                  </span>
                </span>
                <span className="hm-party-btn">{p.joined ? "Open" : "Join"}</span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
