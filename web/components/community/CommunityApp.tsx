"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "@/components/messages/Avatar";
import { countryName } from "@/lib/plans";
import { compact, type Group, type Person, type Post, type Tag } from "@/lib/community-types";
import Feed, { useToast } from "./Feed";
import { call } from "./PostCard";

type Me = { id: string; name: string; lang: string };

export function FollowButton({ id, following: initial, say, onChange }: { id: string; following: boolean; say: (m: string) => void; onChange?: (on: boolean) => void }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={`cm-btn sm ${on ? "ghost" : "sec"}`} disabled={busy} aria-pressed={on} onClick={async () => {
      setBusy(true);
      const r = await call<{ error?: string }>("follow", { id, on: !on });
      setBusy(false);
      if (r.ok) { setOn(!on); onChange?.(!on); }
      else say(r.data.error ?? "Please try again");
    }}>{on ? "Following" : "Follow"}</button>
  );
}

export function GroupList({ groups, active }: { groups: Group[]; active?: string }) {
  const [making, setMaking] = useState(false);
  return (
    <aside className="cm-left" aria-label="Communities">
      <p className="cm-label">Communities</p>
      <Link href="/community" className={`cm-group ${active === "" ? "on" : ""}`}>Your feed</Link>
      {groups.map((g) => (
        <Link key={g.slug} href={`/community/${g.slug}`} className={`cm-group ${active === g.slug ? "on" : ""}`}>
          {g.name} · {compact(g.members)}{g.joined ? <i aria-label="joined" /> : null}
        </Link>
      ))}
      <button type="button" className="cm-btn sec fit" onClick={() => setMaking(true)}>Create a community</button>
      {making && <CreateGroup onClose={() => setMaking(false)} />}
    </aside>
  );
}

function CreateGroup({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [vis, setVis] = useState<"public" | "private">("public");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="msg-modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="msg-modal cm-modal" role="dialog" aria-modal="true" aria-labelledby="cm-new-h" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setErr("");
        const r = await call<Group & { error?: string }>("groups", { name, about, visibility: vis });
        setBusy(false);
        if (!r.ok) return setErr(r.data.error ?? "The group could not be made");
        router.push(`/community/${r.data.slug}`);
      }}>
        <div className="msg-modal-h"><strong id="cm-new-h">Create a community</strong><button type="button" onClick={onClose} aria-label="Close">×</button></div>
        <label className="cm-field">Name<input className="msg-input" value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={60} required placeholder="Nollywood Nights" /></label>
        <label className="cm-field">About<textarea className="msg-input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={400} rows={3} placeholder="Who is it for, and what happens here?" /></label>
        <div className="cm-seg" role="radiogroup" aria-label="Who can see it">
          <button type="button" role="radio" aria-checked={vis === "public"} className={vis === "public" ? "on" : ""} onClick={() => setVis("public")}>Public<small>Anyone can find and join</small></button>
          <button type="button" role="radio" aria-checked={vis === "private"} className={vis === "private" ? "on" : ""} onClick={() => setVis("private")}>Private<small>Only members see posts</small></button>
        </div>
        {err && <p className="cm-err" role="alert">{err}</p>}
        <button type="submit" className="cm-btn wide" disabled={busy || name.trim().length < 3}>{busy ? "Creating…" : "Create community"}</button>
      </form>
    </div>
  );
}

export default function CommunityApp({ me, groups, posts, more, query, heading, side, author }: {
  me: Me; groups: Group[]; posts: Post[]; more: boolean; query: string; heading?: string;
  side: { country: string; trending: Tag[]; people: Person[] }; author?: { id: string; name: string; following: boolean; followers: number; posts: number; country: string };
}) {
  const [say, toast] = useToast();
  const following = query.includes("following=1");
  return (
    <div className="cm-body">
      <GroupList groups={groups} active={query ? undefined : ""} />
      <section className="cm-center" aria-label="Posts">
        {heading ? (
          <div className="cm-heading">
            {author && <Avatar id={author.id} name={author.name} size={48} />}
            <div><h1>{heading}</h1>{author && <p className="cm-muted">{[author.country && countryName(author.country), `${compact(author.followers)} follower${author.followers === 1 ? "" : "s"}`, `${compact(author.posts)} post${author.posts === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>}</div>
            {author && author.id !== me.id && <FollowButton id={author.id} following={author.following} say={say} />}
            <Link href="/community" className="cm-link">Back to your feed</Link>
          </div>
        ) : (
          <div className="cm-tabs" role="tablist" aria-label="Feed">
            <Link role="tab" aria-selected={!following} href="/community" className={!following ? "on" : ""}>For you</Link>
            <Link role="tab" aria-selected={following} href="/community?following=1" className={following ? "on" : ""}>Following</Link>
          </div>
        )}
        <Feed me={me} query={query} initial={posts} more={more} groups={groups} canPost={!heading || author?.id === me.id} say={say}
          empty={following ? "Follow people and join groups to fill this feed." : heading ? "No posts here yet." : "No posts yet. Be the first to share something."} />
      </section>
      <aside className="cm-right" aria-label="Trending and people">
        <div className="cm-card">
          <h2>Trending{side.country ? ` in ${countryName(side.country)}` : ""}</h2>
          {side.trending.length === 0 ? <p className="cm-muted">Use #hashtags in your posts and the top ones show here.</p>
            : side.trending.map((t, i) => <Link key={t.tag} href={`/community?tag=${encodeURIComponent(t.tag)}`} className="cm-trend">#{t.tag} · {compact(t.posts)}{i === 0 ? " posts" : ""}</Link>)}
        </div>
        <div className="cm-card">
          <h2>People to follow</h2>
          {side.people.length === 0 ? <p className="cm-muted">As people post, you will find fans to follow here.</p> : side.people.map((p) => (
            <div key={p.id} className="cm-person">
              <Link href={`/u/${p.id}`}><Avatar id={p.id} name={p.name} size={36} /></Link>
              <div><Link href={`/u/${p.id}`}>{p.name}</Link><span>{[p.country && countryName(p.country), p.note].filter(Boolean).join(" · ")}</span></div>
              <FollowButton id={p.id} following={p.following} say={say} />
            </div>
          ))}
        </div>
      </aside>
      {toast}
    </div>
  );
}
