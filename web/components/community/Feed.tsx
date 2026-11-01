"use client";

import { useCallback, useEffect, useState } from "react";
import type { Group, Post } from "@/lib/community-types";
import Composer from "./Composer";
import PostCard, { call } from "./PostCard";

export function useToast() {
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? <div className="msg-toast" role="status">{toast}</div> : null;
  return [setToast, node] as const;
}

// A list of posts with the composer on top and "Load more" at the bottom.
export default function Feed({ me, query, initial, more: initialMore, groups, group, canPost, slim = false, filter, empty, say }: {
  me: { id: string; name: string; lang: string }; query: string; initial: Post[]; more: boolean; groups: Group[]; group?: string;
  canPost: boolean; slim?: boolean; filter?: (p: Post) => boolean; empty: string; say: (m: string) => void;
}) {
  const [posts, setPosts] = useState(initial);
  const [more, setMore] = useState(initialMore);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPosts(initial); setMore(initialMore); }, [initial, initialMore]);

  const loadMore = useCallback(async () => {
    const last = posts[posts.length - 1];
    if (!last || busy) return;
    setBusy(true);
    const r = await call<{ posts: Post[]; more: boolean }>(`posts?${query}${query ? "&" : ""}before=${last.id}`);
    setBusy(false);
    if (r.ok) { setPosts((p) => [...p, ...r.data.posts.filter((x) => !p.some((y) => y.id === x.id))]); setMore(r.data.more); }
  }, [posts, busy, query]);

  const shown = filter ? posts.filter(filter) : posts;
  return (
    <>
      {canPost && <Composer me={me} groups={groups} group={group} say={say} onPosted={(p) => setPosts((list) => [p, ...list])} />}
      {shown.length === 0 && <div className="cm-empty"><p>{empty}</p></div>}
      {shown.map((p) => <PostCard key={p.id} post={p} me={me} compactView={slim} say={say} onGone={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />)}
      {more && shown.length > 0 && <button type="button" className="cm-more-btn" onClick={loadMore} disabled={busy}>{busy ? "Loading…" : "Load more"}</button>}
    </>
  );
}
