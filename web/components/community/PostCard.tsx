"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/messages/Avatar";
import { langName } from "@/lib/i18n";
import { ago, compact, endsIn, type Comment, type Post } from "@/lib/community-types";

// One post on the feed (Figma 32:901 text/clip, 32:927 poll) or the group page (96:1520).
export async function call<T>(path: string, body?: object): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(`/api/community/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T;
  return { ok: r.ok, status: r.status, data };
}
const errOf = (d: unknown) => (d as { error?: string })?.error ?? "Something went wrong. Please try again.";

const Heart = ({ on }: { on: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
);
const Bubble = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>
);
const ShareIc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15V4M8 8l4-4 4 4M5 12v7h14v-7" /></svg>
);

function Poll({ post, onChange, say }: { post: Post; onChange: (p: Partial<Post>) => void; say: (m: string) => void }) {
  const opts = post.options ?? [];
  const total = opts.reduce((n, o) => n + o.votes, 0);
  const closed = post.pollEndsAt ? Date.parse(post.pollEndsAt) <= Date.now() : true;
  const show = post.myVote !== undefined || closed;
  const top = Math.max(...opts.map((o) => o.votes));
  return (
    <div className="cm-poll" role="group" aria-label="Poll">
      {opts.map((o, i) => {
        const pct = total ? Math.round((o.votes / total) * 100) : 0;
        return show ? (
          <div key={i} className={`cm-opt ${post.myVote === i ? "mine" : ""} ${closed && o.votes === top && top > 0 ? "win" : ""}`}>
            <span className="cm-fill" style={{ width: `${pct}%` }} />
            <span className="cm-opt-t"><span>{o.label}{post.myVote === i ? " ✓" : ""}</span><span>{pct}%</span></span>
          </div>
        ) : (
          <button key={i} type="button" className="cm-opt vote" onClick={async () => {
            const r = await call<{ options: Post["options"]; myVote: number }>(`posts/${post.id}/vote`, { option: i });
            if (r.ok) onChange({ options: r.data.options, myVote: r.data.myVote });
            else say(errOf(r.data));
          }}>
            <span className="cm-opt-t"><span>{o.label}</span></span>
          </button>
        );
      })}
      <p className="cm-fine">{compact(total)} vote{total === 1 ? "" : "s"} · {post.pollEndsAt ? endsIn(post.pollEndsAt) : ""}</p>
    </div>
  );
}

function Comments({ post, me, onCount, say }: { post: Post; me: { id: string; name: string }; onCount: (n: number) => void; say: (m: string) => void }) {
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void call<{ comments: Comment[] }>(`posts/${post.id}/comments`).then((r) => setList(r.ok ? r.data.comments ?? [] : []));
  }, [post.id]);
  return (
    <div className="cm-comments">
      {list === null ? <p className="cm-fine">Loading comments…</p> : list.length === 0 ? <p className="cm-fine">No comments yet. Start the conversation.</p> : (
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              <Avatar id={c.author.id} name={c.author.name} size={28} />
              <div><strong>{c.author.name}</strong> <span className="cm-fine">{ago(c.createdAt)}</span><p>{c.body}</p></div>
            </li>
          ))}
        </ul>
      )}
      <form className="cm-reply" onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim() || busy) return;
        setBusy(true);
        const r = await call<Comment>(`posts/${post.id}/comments`, { body: text });
        setBusy(false);
        if (!r.ok) return say(errOf(r.data));
        setList((l) => [...(l ?? []), r.data]);
        setText("");
        onCount((list?.length ?? 0) + 1);
      }}>
        <Avatar id={me.id} name={me.name} size={28} />
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Write a comment…" aria-label="Write a comment" />
        <button type="submit" className="cm-btn sm" disabled={!text.trim() || busy}>Reply</button>
      </form>
    </div>
  );
}

export default function PostCard({ post: initial, me, compactView = false, onGone, say, openComments = false }: {
  post: Post; me: { id: string; name: string; lang: string }; compactView?: boolean; onGone?: (id: number) => void; say: (m: string) => void; openComments?: boolean;
}) {
  const [post, setPost] = useState(initial);
  const [menu, setMenu] = useState(false);
  const [talk, setTalk] = useState(openComments);
  const [tr, setTr] = useState<{ body: string; source: string } | null>(null);
  const [original, setOriginal] = useState(false);
  const [trBusy, setTrBusy] = useState(false);
  const upd = (p: Partial<Post>) => setPost((x) => ({ ...x, ...p }));
  const mine = post.author.id === me.id;
  const link = `/community/post/${post.id}`;

  const like = async () => {
    const on = !post.liked;
    upd({ liked: on, likes: post.likes + (on ? 1 : -1) });
    const r = await call<{ likes: number }>(`posts/${post.id}/like`, { on });
    if (r.ok) upd({ likes: r.data.likes });
    else { upd({ liked: !on, likes: post.likes }); say(errOf(r.data)); }
  };
  const share = async () => {
    const url = `${location.origin}${link}`;
    try {
      if (navigator.share) await navigator.share({ title: `${post.author.name} on E-Cinema`, url });
      else { await navigator.clipboard.writeText(url); say("Link copied"); }
      const r = await call<{ shares: number }>(`posts/${post.id}/share`, {});
      if (r.ok) upd({ shares: r.data.shares });
    } catch {}
  };
  const translate = async () => {
    if (tr) return setOriginal((o) => !o);
    setTrBusy(true);
    const r = await call<{ body: string; source: string }>(`posts/${post.id}/translate`, { lang: me.lang });
    setTrBusy(false);
    if (!r.ok) return say(errOf(r.data));
    if (!r.data.body || r.data.body.trim() === post.body.trim() || r.data.source === me.lang) { say(`Already in ${langName(me.lang)}`); upd({ lang: r.data.source || me.lang }); return; }
    setTr(r.data);
  };
  const act = async (what: "delete" | "pin" | "unpin" | "report", reason?: string) => {
    setMenu(false);
    const r = what === "pin" || what === "unpin" ? await call(`posts/${post.id}/pin`, { on: what === "pin" })
      : what === "report" ? await call(`posts/${post.id}/report`, { reason })
        : await call(`posts/${post.id}/delete`, {});
    if (!r.ok) return say(errOf(r.data));
    if (what === "delete") { say("Post deleted"); onGone?.(post.id); }
    else if (what === "report") { say("Thanks. Our team will review it."); onGone?.(post.id); }
    else { upd({ pinned: what === "pin" }); say(what === "pin" ? "Pinned to the top of the group" : "Unpinned"); }
  };

  const meta = compactView
    ? [ago(post.createdAt) === "now" ? "just now" : `${ago(post.createdAt)} ago`, post.pinned ? "Pinned" : "", post.kind === "poll" ? `${compact((post.options ?? []).reduce((n, o) => n + o.votes, 0))} votes` : `${compact(post.likes)} likes`].filter(Boolean).join(" · ")
    : [post.community?.name, ago(post.createdAt), post.film ? `watched ${post.film}` : "", post.pinned ? "Pinned" : ""].filter(Boolean).join(" · ");
  const canTranslate = Boolean(post.body.trim()) && post.lang !== me.lang;
  const body = tr && !original ? tr.body : post.body;

  return (
    <article className={`cm-post ${compactView ? "slim" : ""}`}>
      <header className="cm-post-h">
        <Link href={`/u/${post.author.id}`} className="cm-who" aria-label={post.author.name}><Avatar id={post.author.id} name={post.author.name} size={compactView ? 34 : 40} /></Link>
        <div className="cm-post-t">
          <Link href={`/u/${post.author.id}`}>{post.author.name}</Link>
          <span>{post.community && !compactView ? <><Link href={`/community/${post.community.slug}`}>{post.community.name}</Link>{meta.slice(post.community.name.length)}</> : meta}</span>
        </div>
        <div className="cm-menu-w">
          <button type="button" className="cm-more" onClick={() => setMenu((m) => !m)} aria-label="Post options" aria-expanded={menu}>···</button>
          {menu && (
            <div className="cm-menu" role="menu">
              <button role="menuitem" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}${link}`); setMenu(false); say("Link copied"); }}>Copy link</button>
              {post.canModerate && post.community && <button role="menuitem" onClick={() => act(post.pinned ? "unpin" : "pin")}>{post.pinned ? "Unpin" : "Pin to top"}</button>}
              {post.canModerate && <button role="menuitem" className="danger" onClick={() => act("delete")}>Delete post</button>}
              {!mine && (
                <>
                  <button role="menuitem" onClick={() => act("report", "spoiler")}>Report: spoiler</button>
                  <button role="menuitem" onClick={() => act("report", "spam")}>Report: spam</button>
                  <button role="menuitem" onClick={() => act("report", "abuse")}>Report: abuse</button>
                  <button role="menuitem" onClick={() => act("report", "piracy")}>Report: pirated film</button>
                </>
              )}
            </div>
          )}
        </div>
      </header>
      {body && <p className="cm-text">{renderTags(body)}</p>}
      {post.kind === "photo" && post.mediaKey && (
        <a href={`/api/community/posts/${post.id}/photo`} target="_blank" rel="noopener noreferrer" className="cm-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/community/posts/${post.id}/photo`} alt={post.body || `Photo from ${post.author.name}`} loading="lazy" />
        </a>
      )}
      {post.kind === "poll" && <Poll post={post} onChange={upd} say={say} />}
      {!compactView && (
        <footer className="cm-acts">
          <button type="button" className={post.liked ? "on" : ""} onClick={like} aria-pressed={post.liked} aria-label={post.liked ? "Unlike" : "Like"}><Heart on={post.liked} /><span>{compact(post.likes)}</span></button>
          <button type="button" onClick={() => setTalk((t) => !t)} aria-expanded={talk} aria-label="Comments"><Bubble /><span>{compact(post.comments)}</span></button>
          <button type="button" onClick={share}><ShareIc /><span>Share</span></button>
          <span className="cm-sp" />
          {tr ? (
            <button type="button" className="cm-tr" onClick={() => setOriginal((o) => !o)}>
              {original ? "See translation" : `Translated from ${tr.source ? langName(tr.source) : "another language"} · see original`}
            </button>
          ) : canTranslate ? (
            <button type="button" className="cm-tr" onClick={translate} disabled={trBusy}>{trBusy ? "Translating…" : `Translate to ${langName(me.lang)}`}</button>
          ) : null}
        </footer>
      )}
      {compactView && (
        <footer className="cm-acts slim">
          <button type="button" className={post.liked ? "on" : ""} onClick={like} aria-pressed={post.liked} aria-label={post.liked ? "Unlike" : "Like"}><Heart on={post.liked} /><span>{compact(post.likes)}</span></button>
          <button type="button" onClick={() => setTalk((t) => !t)} aria-expanded={talk} aria-label="Comments"><Bubble /><span>{compact(post.comments)}</span></button>
          <button type="button" onClick={share} aria-label="Share"><ShareIc /></button>
          {canTranslate && <button type="button" className="cm-tr" onClick={translate} disabled={trBusy}>{tr ? (original ? "See translation" : "See original") : trBusy ? "Translating…" : "Translate"}</button>}
        </footer>
      )}
      {talk && <Comments post={post} me={me} onCount={(n) => upd({ comments: n })} say={say} />}
    </article>
  );
}

// Hashtags link to their feed.
function renderTags(text: string) {
  const parts = text.split(/(#[\p{L}\p{M}\p{N}_]{2,40})/u);
  return parts.map((p, i) => (i % 2 ? <Link key={i} href={`/community?tag=${encodeURIComponent(p.slice(1).toLowerCase())}`} className="cm-tag">{p}</Link> : p));
}
