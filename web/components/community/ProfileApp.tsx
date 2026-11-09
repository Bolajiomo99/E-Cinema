"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { avatarColor, initials } from "@/lib/chat-types";
import { findShowtime } from "@/lib/catalog";
import { countryName } from "@/lib/plans";
import { compact, type Badge, type Post, type ProfilePage, type ProfileReview, type Watched } from "@/lib/community-types";
import { useToast } from "./Feed";
import { call } from "./PostCard";
import { FollowButton } from "./CommunityApp";

// Built from the Figma frames "Web / Profile" (32:1060), "· Reviews" (95:1863) and "· Badges" (95:2002).
type Tab = "posts" | "clips" | "watched" | "reviews" | "badges";
const TABS: [Tab, string][] = [["posts", "Posts"], ["clips", "Clips"], ["watched", "Watched"], ["reviews", "Reviews"], ["badges", "Badges"]];
const TIER: Record<string, string> = { student: "STUDENT", pro: "PRO", vip: "VIP", enterprise: "ENTERPRISE" };
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const GLOWS = ["rgba(227,24,45,.45)", "rgba(70,150,255,.45)", "rgba(255,140,40,.45)", "rgba(139,124,246,.45)", "rgba(43,179,163,.45)"];

export default function ProfileApp({ page: initial, posts: firstPosts, more: firstMore, tab: firstTab }: { page: ProfilePage; posts: Post[]; more: boolean; tab: Tab }) {
  const [say, toast] = useToast();
  const [p, setP] = useState(initial);
  const [tab, setTab] = useState<Tab>(firstTab);
  const [editing, setEditing] = useState(false);

  const pick = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "posts") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u);
  };
  const share = async () => {
    const url = `${window.location.origin}/u/${p.username || p.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `${p.name} on E-Cinema`, url });
      else { await navigator.clipboard.writeText(url); say("Profile link copied"); }
    } catch { /* closed the share sheet */ }
  };

  const place = [p.city, p.country].filter(Boolean).join(", ");
  const line = [p.username && `@${p.username}`, place || (p.country && countryName(p.country)), p.interests, p.spoken.length > 0 && `speaks ${p.spoken.join(", ")}`].filter(Boolean).join(" · ");
  const tier = TIER[p.plan];
  return (
    <>
      <div className="pf-cover" aria-hidden><i /></div>
      <header className="pf-head">
        <span className="pf-av" style={{ background: avatarColor(p.id) }} aria-hidden>{initials(p.name)}</span>
        <div className="pf-t">
          <div className="pf-n">
            <h1>{p.name}</h1>
            {tier && <span className={`pf-badge tier ${p.plan}`}>{tier}</span>}
            {p.verified && <span className="pf-badge" title="Face and ID checked">VERIFIED</span>}
          </div>
          <p>{line || (p.me ? "Add your city, what you love and the languages you speak." : `Joined ${new Date(p.joinedAt).toLocaleDateString([], { month: "long", year: "numeric" })}`)}</p>
        </div>
        <div className="pf-b">
          {p.me ? <button type="button" className="pf-btn sec" onClick={() => setEditing(true)}>Edit profile</button>
            : <FollowButton id={p.id} following={p.following} say={say} onChange={(on) => setP((x) => ({ ...x, following: on, followers: x.followers + (on ? 1 : -1) }))} />}
          <button type="button" className="pf-btn ghost" onClick={share}>Share</button>
        </div>
      </header>
      <dl className="pf-stats">
        <div><dt>followers</dt><dd>{p.followers.toLocaleString()}</dd></div>
        <div><dt>following</dt><dd>{p.follows.toLocaleString()}</dd></div>
        <div><dt>premieres</dt><dd>{p.premieres.toLocaleString()}</dd></div>
        <div><dt>countries chatted</dt><dd>{p.countries.toLocaleString()}</dd></div>
        <div title="The AI snack critic is coming soon"><dt>avg snack score</dt><dd className="soon">— <small>Soon</small></dd></div>
      </dl>
      <div className="pf-tabs cm-chips" role="tablist" aria-label="Profile sections">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>)}
      </div>
      <section className="pf-body" aria-label={TABS.find(([k]) => k === tab)?.[1]}>
        {tab === "posts" && <PostTiles who={p.id} initial={firstPosts} more={firstMore} me={p.me} />}
        {tab === "clips" && <div className="pf-empty"><strong>Clips are coming soon</strong><p>Short clips from premieres will show here once the Clips page opens.</p></div>}
        {tab === "watched" && <WatchedGrid who={p.id} me={p.me} />}
        {tab === "reviews" && <Reviews who={p.id} me={p.me} name={p.name} say={say} />}
        {tab === "badges" && <Badges who={p.id} />}
      </section>
      {editing && <EditProfile page={p} onClose={() => setEditing(false)} onSaved={(c) => { setP((x) => ({ ...x, ...c })); setEditing(false); say("Profile saved"); }} />}
      {toast}
    </>
  );
}

function useList<T>(path: string, key: string) {
  const [data, setData] = useState<{ list: T[]; hidden?: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void call<Record<string, unknown>>(path).then((r) => live && setData(r.ok ? { list: (r.data[key] as T[]) ?? [], hidden: r.data.hidden === true } : { list: [] }));
    return () => { live = false; };
  }, [path, key]);
  return [data, setData] as const;
}

function PostTiles({ who, initial, more: firstMore, me }: { who: string; initial: Post[]; more: boolean; me: boolean }) {
  const [posts, setPosts] = useState(initial);
  const [more, setMore] = useState(firstMore);
  const [busy, setBusy] = useState(false);
  if (posts.length === 0) return <div className="pf-empty"><strong>No posts yet</strong><p>{me ? "Share a thought, poll or snack photo in Community." : "When they post in Community, it shows here."}</p>{me && <Link href="/community" className="cm-btn">Go to Community</Link>}</div>;
  return (
    <>
      <div className="pf-grid">
        {posts.map((x, i) => (
          <Link key={x.id} href={`/community/post/${x.id}`} className="pf-tile" aria-label={`${x.kind === "poll" ? "Poll" : x.kind === "photo" ? "Photo" : "Post"}: ${x.body.slice(0, 80)}`}>
            {x.kind === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/community/posts/${x.id}/photo`} alt="" loading="lazy" />
            ) : (
              <>
                <i style={{ background: GLOWS[i % GLOWS.length] }} aria-hidden />
                <span className="pf-tile-text">{x.kind === "poll" && <b>Poll</b>}{x.body}</span>
              </>
            )}
            <span className="pf-tile-m">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21Z" /></svg>
              {compact(x.likes)}
            </span>
          </Link>
        ))}
      </div>
      {more && <button type="button" className="cm-more-btn" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await call<{ posts: Post[]; more: boolean }>(`posts?author=${who}&before=${posts[posts.length - 1].id}`);
        setBusy(false);
        if (r.ok) { setPosts((l) => [...l, ...r.data.posts.filter((n) => !l.some((o) => o.id === n.id))]); setMore(r.data.more); }
      }}>{busy ? "Loading…" : "Load more"}</button>}
    </>
  );
}

function WatchedGrid({ who, me }: { who: string; me: boolean }) {
  const [data] = useList<Watched>(`people/${who}/watched`, "watched");
  if (!data) return <p className="cm-muted">Loading…</p>;
  if (data.list.length === 0) return <div className="pf-empty"><strong>No premieres yet</strong><p>{me ? "Films you watch live, for ten minutes or more, show here." : "Premieres they watch live show here."}</p>{me && <Link href="/browse" className="cm-btn">Find a premiere</Link>}</div>;
  return (
    <div className="pf-grid watched">
      {data.list.map((w) => {
        const s = findShowtime(w.showtimeId);
        const c = s?.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: GLOWS[0] };
        return (
          <Link key={w.showtimeId} href={`/film/${w.showtimeId}`} className="pf-tile" style={{ background: `linear-gradient(180deg, ${c.from} 0%, ${c.via} 60%, ${c.to} 100%)` }}>
            <i style={{ background: c.glow }} aria-hidden />
            <span className="pf-tile-title">{w.film}</span>
            <span className="pf-tile-m">{new Date(w.startsAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} · {w.minutes} min{w.stars > 0 && <em> · {stars(w.stars)}</em>}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Reviews({ who, me, name, say }: { who: string; me: boolean; name: string; say: (m: string) => void }) {
  const [data, setData] = useList<ProfileReview>(`people/${who}/reviews`, "reviews");
  if (!data) return <p className="cm-muted">Loading…</p>;
  if (data.hidden) return <div className="pf-empty"><strong>Reviews are private</strong><p>{name} keeps their reviews to themselves.</p></div>;
  if (data.list.length === 0) return <div className="pf-empty"><strong>No reviews yet</strong><p>{me ? "After a premiere ends you can rate it and say what you thought." : "Their reviews show here after they rate a premiere."}</p></div>;
  const like = async (r: ProfileReview) => {
    const res = await call<{ likes: number; error?: string }>(`people/${who}/reviews/${r.showtimeId}/like`, { on: !r.liked });
    if (!res.ok) return say(res.data.error ?? "Please try again");
    setData((d) => d && { ...d, list: d.list.map((x) => (x.showtimeId === r.showtimeId ? { ...x, liked: !r.liked, likes: res.data.likes } : x)) });
  };
  return (
    <div className="pf-reviews">
      {data.list.map((r) => (
        <article key={r.showtimeId} className="pf-review">
          <div className="pf-review-h"><Link href={`/film/${r.showtimeId}`}>{r.film}</Link><span aria-label={`${r.stars} out of 5 stars`}>{stars(r.stars)}</span></div>
          {r.body && <p translate="no">{r.body}</p>}
          {r.tags.length > 0 && <div className="pf-review-tags">{r.tags.map((t) => <span key={t}>{t}</span>)}</div>}
          <div className="pf-review-m">
            {me ? <span>{r.likes.toLocaleString()} like{r.likes === 1 ? "" : "s"}</span>
              : <button type="button" aria-pressed={r.liked} className={r.liked ? "on" : ""} onClick={() => like(r)}>{r.liked ? "Liked" : "Like"} · {r.likes.toLocaleString()}</button>}
            <span>{new Date(r.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function Badges({ who }: { who: string }) {
  const [data] = useList<Badge>(`people/${who}/badges`, "badges");
  if (!data) return <p className="cm-muted">Loading…</p>;
  return (
    <ul className="pf-badges">
      {data.list.map((b) => (
        <li key={b.key} className={b.earned ? "earned" : ""} style={b.earned ? { borderColor: b.color } : undefined}>
          <span className="pf-medal" style={b.earned ? { background: `${b.color}33`, color: b.color } : undefined} aria-hidden>{b.letter}</span>
          <strong>{b.name}</strong>
          <small>{b.about}</small>
          {!b.earned && b.goal > 1 && <span className="pf-prog" aria-label={`${b.progress} of ${b.goal}`}><i style={{ width: `${(b.progress / b.goal) * 100}%` }} /></span>}
          <span className="sr-only">{b.earned ? "Earned" : "Not earned yet"}</span>
        </li>
      ))}
    </ul>
  );
}

function EditProfile({ page, onClose, onSaved }: { page: ProfilePage; onClose: () => void; onSaved: (c: Pick<ProfilePage, "city" | "interests" | "spoken">) => void }) {
  const router = useRouter();
  const [city, setCity] = useState(page.city);
  const [interests, setInterests] = useState(page.interests);
  const [spoken, setSpoken] = useState(page.spoken.join(", "));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="msg-modal-bg" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="msg-modal cm-modal" role="dialog" aria-modal="true" aria-labelledby="pf-edit-h" onSubmit={async (e) => {
        e.preventDefault();
        const langs = spoken.split(",").map((x) => x.trim()).filter(Boolean);
        if (langs.length > 6) return setErr("List up to 6 languages");
        setBusy(true); setErr("");
        const r = await call<{ error?: string }>("profile", { city, interests, spoken: langs });
        setBusy(false);
        if (!r.ok) return setErr(r.data.error ?? "Your profile could not be saved");
        onSaved({ city: city.trim(), interests: interests.trim(), spoken: langs });
        router.refresh();
      }}>
        <div className="msg-modal-h"><strong id="pf-edit-h">Edit profile</strong><button type="button" onClick={onClose} aria-label="Close">×</button></div>
        <label className="cm-field">City<input className="msg-input" value={city} onChange={(e) => setCity(e.target.value)} maxLength={40} placeholder="Lagos" autoComplete="address-level2" /></label>
        <label className="cm-field">What you love<input className="msg-input" value={interests} onChange={(e) => setInterests(e.target.value)} maxLength={80} placeholder="Thrillers, K-drama, zobo" /></label>
        <label className="cm-field">Languages you speak<input className="msg-input" value={spoken} onChange={(e) => setSpoken(e.target.value)} placeholder="English, Yorùbá, Igbo" /></label>
        <p className="cm-fine">Change your name, username or photo privacy in <Link href="/settings" className="cm-link">Settings</Link>.</p>
        {err && <p className="cm-err" role="alert">{err}</p>}
        <button type="submit" className="cm-btn wide" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </form>
    </div>
  );
}
