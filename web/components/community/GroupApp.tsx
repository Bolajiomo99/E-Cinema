"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Avatar from "@/components/messages/Avatar";
import { countryName } from "@/lib/plans";
import type { Group, GroupParty, Post } from "@/lib/community-types";
import { compact } from "@/lib/community-types";
import Feed, { useToast } from "./Feed";
import { call } from "./PostCard";

// Built from the Figma frame "Web / Community · Group page" (96:1566).
type Tab = "posts" | "parties" | "polls" | "members" | "rules";
type Member = { id: string; name: string; country: string; role: string; joinedAt: string };
type MyParty = { code: string; name: string; film: string; startsAt: string; isHost: boolean; visibility: string };

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function GroupApp({ me, group: initial, parties, posts, more, myParties }: {
  me: { id: string; name: string; lang: string }; group: Group & { countries?: string[] }; parties: GroupParty[]; posts: Post[]; more: boolean; myParties: MyParty[];
}) {
  const router = useRouter();
  const [say, toast] = useToast();
  const [g, setG] = useState(initial);
  const [tab, setTab] = useState<Tab>("posts");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const listable = myParties.filter((p) => p.isHost && p.visibility === "link" && Date.parse(p.startsAt) > Date.now() && !parties.some((x) => x.code === p.code));

  useEffect(() => {
    if (tab === "members" && members === null) void call<{ members: Member[] }>(`groups/${g.slug}/members`).then((r) => setMembers(r.ok ? r.data.members : []));
  }, [tab, members, g.slug]);

  const join = async () => {
    setBusy(true);
    const r = await call<{ error?: string }>(`groups/${g.slug}/${g.joined ? "leave" : "join"}`, {});
    setBusy(false);
    if (!r.ok) return say(r.data.error ?? "Please try again");
    setG((x) => ({ ...x, joined: !x.joined, members: x.members + (x.joined ? -1 : 1), role: x.joined ? undefined : "member" }));
    setMembers(null);
    say(g.joined ? `You left ${g.name}` : `Welcome to ${g.name}`);
  };

  const where = [`${g.members.toLocaleString()} member${g.members === 1 ? "" : "s"}`, `${g.visibility} group`, (g.countries ?? []).map(countryName).join(", ")].filter(Boolean).join(" · ");
  return (
    <>
      <header className="cm-cover">
        <h1>{g.name}</h1>
        <p>{where}</p>
      </header>
      <div className="cm-gbody">
        <section className="cm-gfeed" aria-label={g.name}>
          <div className="cm-chips" role="tablist" aria-label="Group sections">
            {([["posts", "Posts"], ["parties", "Watch parties"], ["polls", "Polls"], ["members", "Members"], ["rules", "Rules"]] as const).map(([k, l]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {(tab === "posts" || tab === "polls") && (
            <Feed me={me} query={`community=${g.slug}`} initial={posts} more={more} groups={[g]} group={g.slug} canPost={g.joined && tab === "posts"} slim say={say}
              filter={tab === "polls" ? (p) => p.kind === "poll" : undefined}
              empty={tab === "polls" ? "No polls yet. Start one from the Posts tab." : g.joined ? "No posts yet. Say hello to the group." : "No posts yet. Join to start the conversation."} />
          )}
          {tab === "parties" && (
            <div className="cm-card">
              {parties.length === 0 ? <p className="cm-muted">No watch parties listed yet.</p> : parties.map((p) => (
                <Link key={p.code} href={`/p/${p.code}`} className="cm-party"><strong>{p.name}</strong><span>{when(p.startsAt)} · {p.film}</span></Link>
              ))}
              {g.joined && (listable.length > 0 ? (
                <form className="cm-listparty" onSubmit={async (e) => {
                  e.preventDefault();
                  if (!pick) return;
                  const r = await call<{ error?: string }>(`groups/${g.slug}/party`, { code: pick, on: true });
                  if (!r.ok) return say(r.data.error ?? "That party could not be listed");
                  say("Your party is listed on the group");
                  router.refresh();
                }}>
                  <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Your party"><option value="">Choose a party you host…</option>{listable.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.film} · {when(p.startsAt)}</option>)}</select>
                  <button type="submit" className="cm-btn sm" disabled={!pick}>List it here</button>
                </form>
              ) : <p className="cm-fine">Host a party with a share link and you can list it here. <Link href="/parties/new" className="cm-link">Start a party</Link></p>)}
            </div>
          )}
          {tab === "members" && (
            <div className="cm-card">
              {members === null ? <p className="cm-muted">Loading members…</p> : members.map((m) => (
                <div key={m.id} className="cm-person">
                  <Link href={`/u/${m.id}`}><Avatar id={m.id} name={m.name} size={36} /></Link>
                  <div><Link href={`/u/${m.id}`}>{m.name}</Link><span>{[m.role !== "member" ? (m.role === "owner" ? "Owner" : "Moderator") : "", m.country && countryName(m.country)].filter(Boolean).join(" · ")}</span></div>
                </div>
              ))}
              {members && g.members > members.length && <p className="cm-fine">Showing {members.length} of {compact(g.members)} members.</p>}
            </div>
          )}
          {tab === "rules" && (
            <div className="cm-card"><h2>Group rules</h2><p className="cm-pre">{g.rules || "Be kind. No spoilers before the credits roll. No pirated links, ever."}</p><p className="cm-fine">E-Cinema community rules apply everywhere: no harassment, no hate, no piracy.</p></div>
          )}
        </section>
        <aside className="cm-gside">
          <div className="cm-card">
            <h2>About this group</h2>
            <p className="cm-muted">{g.about || "A place for fans to plan parties and talk film."}</p>
            {g.role === "owner" ? <p className="cm-fine">You created this group.</p> : (
              <button type="button" className={`cm-btn wide ${g.joined ? "sec" : ""}`} onClick={join} disabled={busy}>{g.joined ? "Leave group" : "Join group"}</button>
            )}
          </div>
          <div className="cm-card">
            <h2>Upcoming parties</h2>
            {parties.length === 0 ? <p className="cm-muted">None yet. Members can list their parties here.</p>
              : parties.map((p) => <Link key={p.code} href={`/p/${p.code}`} className="cm-up">{when(p.startsAt)} · {p.film} · {p.name}</Link>)}
          </div>
        </aside>
      </div>
      {toast}
    </>
  );
}
