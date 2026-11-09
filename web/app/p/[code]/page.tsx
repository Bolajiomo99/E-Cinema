import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Logo from "@/components/landing/Logo";
import LocalWhen from "@/components/dash/LocalWhen";
import PartyActions from "@/components/parties/PartyActions";
import { myTickets } from "@/lib/api";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { endsAt, findShowtime } from "@/lib/catalog";
import { ruleLabel, type Party } from "@/lib/parties";

// A watch party's own page: the link guests open, and the host's control room.
export const dynamic = "force-dynamic";
export const metadata = { title: "Watch party · E-Cinema" };

const COLORS = ["#7c3aed", "#0ea5e9", "#f59e0b", "#16a34a", "#e11d48", "#14b8a6"];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export default async function PartyPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string; emailed?: string }> }) {
  const [{ code }, sp, me] = await Promise.all([params, searchParams, currentAccount()]);
  if (!/^[a-z0-9-]{6,40}$/.test(code)) notFound();
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const r = await accountApi("GET", `/v1/parties/${code}`, undefined, session);
  if (r.status === 404) notFound();
  if (r.status !== 200) throw new Error("Party unavailable");
  const party = r.body as Party;
  const s = findShowtime(party.showtimeId);
  const ended = s ? endsAt(s) < Date.now() : false;
  const live = s ? Date.parse(s.startsAt) <= Date.now() && !ended : false;
  const lobby = s ? Date.parse(s.startsAt) - Date.now() < 30 * 60_000 : false;
  const seat = me ? (await myTickets(session).catch(() => [])).find((t) => t.showtimeId === party.showtimeId && t.status === "paid") : undefined;
  const p = s?.poster ?? { from: "#0c2a3a", via: "#06121a", to: "#000", glow: "rgba(70,150,255,.45)" };
  const link = `${process.env.WEB_URL || "https://e-cinema.net"}/p/${party.code}`;
  const here = `/p/${party.code}`;

  return (
    <main id="main" className="wp party" style={{ background: `linear-gradient(90deg, ${p.from} 0%, ${p.via} 60%, #000 100%)` }}>
      <span className="wp-glow" style={{ background: `radial-gradient(circle, ${p.glow}, transparent 70%)` }} aria-hidden />
      <span className="wp-dim" aria-hidden />
      <nav className="party-nav"><Logo href={me ? "/home" : "/"} /></nav>
      <section className="wp-modal" aria-labelledby="party-title">
        {sp.new && <p className="party-new">Your party is ready. Share the link below{Number(sp.emailed) > 0 ? `; we emailed ${Number(sp.emailed)} ${Number(sp.emailed) === 1 ? "person" : "people"}` : ""}.</p>}
        <div className="party-top">
          <span className="party-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }} />
          <div>
            <div className="lp-badges">
              {live ? <span className="lp-badge live"><i />LIVE NOW</span> : ended ? <span className="lp-badge outline">ENDED</span> : <span className="lp-badge outline">WATCH PARTY</span>}
              <span className="lp-badge outline">{party.visibility === "invite" ? "INVITE ONLY" : "ANYONE WITH LINK"}</span>
            </div>
            <h1 id="party-title">{party.name}</h1>
            <p className="party-sub">{party.film} · <LocalWhen iso={party.startsAt} /></p>
            <p className="party-sub">Hosted by {party.hostName} · {party.members.toLocaleString("en-US")} joined</p>
          </div>
        </div>

        {party.rules.length > 0 && (
          <div className="wp-chips wrap" aria-label="Room rules">
            {party.rules.map((r) => <span key={r} className="wp-chip on static">{ruleLabel(r)}</span>)}
          </div>
        )}

        {party.joined && party.people && (
          <div className="party-people">
            <div className="party-stack">
              {party.people.slice(0, 5).map((m, i) => <span key={i} className="party-av" style={{ background: COLORS[i % COLORS.length] }} title={m.name}>{initials(m.name)}</span>)}
              {party.members > 5 && <span className="party-av more">+{party.members - 5}</span>}
            </div>
            <small>{party.people.slice(0, 3).map((m) => m.name.split(" ")[0]).join(", ")}{party.members > 3 ? ` and ${party.members - 3} more` : ""}</small>
          </div>
        )}

        <PartyActions
          code={party.code}
          link={link}
          film={party.film}
          signedIn={Boolean(me)}
          joined={party.joined}
          isHost={party.isHost}
          inviteOnly={party.visibility === "invite"}
          invited={party.invited ?? []}
          ended={ended}
          seat={Boolean(seat)}
          roomOpen={lobby || live}
          showtimeId={party.showtimeId}
          signinHref={`/signin?next=${encodeURIComponent(here)}`}
        />
      </section>
    </main>
  );
}
