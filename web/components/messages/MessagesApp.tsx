"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countryName } from "@/lib/plans";
import { langName } from "@/lib/i18n";
import type { ChatEvent, Conversation, FriendRequest, Message, Party, Person, Thread } from "@/lib/chat-types";
import { preview } from "@/lib/chat-types";
import Avatar from "./Avatar";
import Bubble from "./Bubble";
import Composer, { type Outgoing } from "./Composer";
import { IconBack, IconClose, IconLock, IconMore, IconPen, IconPhone, IconSearch, IconVideo } from "./icons";

type Tab = "all" | "friends" | "groups" | "requests";
type Me = { id: string; name: string; lang: string };

const api = async <T,>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> => {
  const r = await fetch(`/api/chat${path}`, { cache: "no-store", ...init, headers: init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : undefined });
  const data = r.status === 204 ? ({} as T) : ((await r.json().catch(() => ({}))) as T);
  return { ok: r.ok, status: r.status, data };
};
const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });

function when(iso: string): string {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86400_000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}
function dayLabel(iso: string): string {
  const w = when(iso);
  return /^\d/.test(w) ? "Today" : w === "Yesterday" ? w : new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

// The live connection: one socket per tab, reconnecting with a fresh pass.
function useLive(onEvent: (e: ChatEvent) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const sock = useRef<WebSocket | null>(null);
  useEffect(() => {
    let stop = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      if (stop) return;
      const r = await api<{ pass?: string; ws?: string }>("/pass").catch(() => null);
      if (stop) return;
      if (!r?.ok || !r.data.pass || !r.data.ws) { timer = setTimeout(connect, Math.min(30_000, 2000 * ++tries)); return; }
      const ws = new WebSocket(`${r.data.ws}/v1/chat/live?t=${encodeURIComponent(r.data.pass)}`);
      sock.current = ws;
      ws.onopen = () => { tries = 0; };
      ws.onmessage = (m) => { try { ref.current(JSON.parse(m.data) as ChatEvent); } catch {} };
      ws.onclose = () => { if (sock.current === ws) sock.current = null; if (!stop) timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++)); };
    };
    void connect();
    return () => { stop = true; clearTimeout(timer); sock.current?.close(); };
  }, []);
  return useCallback((data: object) => { if (sock.current?.readyState === WebSocket.OPEN) sock.current.send(JSON.stringify(data)); }, []);
}

export default function MessagesApp({ me, initial, requestCount, parties, openId, initialTab, startOnList }: {
  me: Me; initial: Conversation[]; requestCount: number; parties: Party[]; openId?: string; initialTab: Tab; startOnList: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [convs, setConvs] = useState<Conversation[]>(initial);
  const [reqCount, setReqCount] = useState(requestCount);
  const [requests, setRequests] = useState<FriendRequest[] | null>(null);
  const [online, setOnline] = useState<Set<string>>(new Set(initial.filter((c) => c.online && c.otherId).map((c) => c.otherId!)));
  const [active, setActive] = useState<string | undefined>(openId);
  const [thread, setThread] = useState<Thread | null>(null);
  const [mobileChat, setMobileChat] = useState(!startOnList && Boolean(openId));
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [composing, setComposing] = useState(false);
  const [toast, setToast] = useState("");
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const asked = useRef<Set<number>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? "" : t)), 4000); }, []);

  const reload = useCallback(async () => {
    const r = await api<{ conversations: Conversation[]; requests: number }>("");
    if (r.ok) { setConvs(r.data.conversations); setReqCount(r.data.requests); }
  }, []);

  const open = useCallback(async (id: string, push = true) => {
    setActive(id);
    if (push) setMobileChat(true);
    const r = await api<Thread>(`/c/${id}`);
    if (!r.ok) { say((r.data as unknown as { error?: string }).error ?? "This chat could not open."); return; }
    setThread(r.data);
    setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    window.dispatchEvent(new Event("ec:messages"));
    if (push) history.replaceState(null, "", `/messages?c=${id}`);
  }, [say]);

  useEffect(() => {
    if (!openId) return;
    void open(openId, false);
    if (!startOnList) setMobileChat(true);
  }, [openId, open, startOnList]);

  useEffect(() => {
    if (tab !== "requests") return;
    void api<{ requests: FriendRequest[] }>("/requests").then((r) => { if (r.ok) { setRequests(r.data.requests); setReqCount(r.data.requests.length); } });
  }, [tab]);

  // Search people (friends, people met in rooms, exact email).
  useEffect(() => {
    if (q.trim().length < 2) { setPeople([]); return; }
    const t = setTimeout(() => void api<{ people: Person[] }>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.ok && setPeople(r.data.people)), 250);
    return () => clearTimeout(t);
  }, [q]);

  const sendLive = useLive((e) => {
    switch (e.type) {
      case "hello": setOnline(new Set(e.online ?? [])); break;
      case "presence": setOnline((s) => { const n = new Set(s); if (e.on) n.add(e.accountId); else n.delete(e.accountId); return n; }); break;
      case "typing": setTyping((t) => ({ ...t, [`${e.conversationId}:${e.accountId}`]: Date.now() })); break;
      case "request": setReqCount((n) => n + 1); if (tab === "requests") void api<{ requests: FriendRequest[] }>("/requests").then((r) => r.ok && setRequests(r.data.requests)); break;
      case "read": setThread((t) => (t && t.conversation.id === e.conversationId ? { ...t, readBy: { ...t.readBy, [e.accountId]: Math.max(t.readBy[e.accountId] ?? 0, e.upto) } } : t)); break;
      case "msg": {
        const m = e.message;
        const here = activeRef.current === m.conversationId;
        setThread((t) => (t && t.conversation.id === m.conversationId && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
        setTyping((t) => { const n = { ...t }; delete n[`${m.conversationId}:${m.senderId}`]; return n; });
        setConvs((cs) => {
          const found = cs.find((c) => c.id === m.conversationId);
          if (!found) { void reload(); return cs; }
          const mine = m.senderId === me.id;
          const upd = { ...found, last: m, lastAt: m.createdAt, unread: here || mine ? 0 : found.unread + 1 };
          return [upd, ...cs.filter((c) => c.id !== m.conversationId)];
        });
        if (here && m.senderId !== me.id && document.visibilityState === "visible") void post(`/c/${m.conversationId}/read`, { upto: m.id });
        if (!here || document.visibilityState !== "visible") window.dispatchEvent(new Event("ec:messages"));
        break;
      }
    }
  });

  // Drop stale typing marks.
  useEffect(() => {
    const t = setInterval(() => setTyping((m) => Object.fromEntries(Object.entries(m).filter(([, at]) => Date.now() - at < 5000))), 2000);
    return () => clearInterval(t);
  }, []);

  // Keep the newest message in view.
  const lastId = thread?.messages[thread.messages.length - 1]?.id;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [lastId, thread?.conversation.id]);

  const translate = useCallback((m: Message) => {
    if (!thread?.conversation.translate || asked.current.has(m.id)) return;
    const src = m.kind === "voice" ? m.transcript : m.kind === "text" || m.kind === "photo" ? m.body : "";
    if (!src?.trim()) return;
    asked.current.add(m.id);
    void post<{ body?: string }>(`/m/${m.id}/translate`, { lang: me.lang }).then((r) => { if (r.ok && r.data.body) setTranslations((t) => ({ ...t, [m.id]: r.data.body! })); });
  }, [thread?.conversation.translate, me.lang]);

  const send = async (o: Outgoing): Promise<boolean> => {
    if (!thread) return false;
    const conv = thread.conversation.id;
    let payload: Record<string, unknown>;
    if (o.kind === "voice" || o.kind === "photo") {
      const fd = new FormData();
      fd.set("kind", o.kind);
      fd.set("file", o.kind === "voice" ? new File([o.blob], "note", { type: o.blob.type }) : o.file);
      const up = await post<{ key?: string; transcript?: string; error?: string }>(`/c/${conv}/upload`, fd);
      if (!up.ok || !up.data.key) { say(up.data.error ?? "That could not be sent."); return false; }
      payload = o.kind === "voice" ? { kind: "voice", mediaKey: up.data.key, durationMs: Math.round(o.durationMs), transcript: up.data.transcript ?? "" } : { kind: "photo", mediaKey: up.data.key, body: o.body };
    } else payload = o;
    const r = await post<Message & { error?: string }>(`/c/${conv}/messages`, payload);
    if (!r.ok) { say(r.data.error ?? "That could not be sent."); return false; }
    const m = r.data;
    setThread((t) => (t && t.conversation.id === conv && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
    setConvs((cs) => { const f = cs.find((c) => c.id === conv); return f ? [{ ...f, last: m, lastAt: m.createdAt }, ...cs.filter((c) => c.id !== conv)] : cs; });
    return true;
  };

  const startDM = async (friendId: string) => {
    const r = await post<{ id?: string; error?: string }>("/dm", { friendId });
    if (!r.ok || !r.data.id) return say(r.data.error ?? "That chat could not open.");
    setQ(""); setComposing(false); setTab("all");
    if (!convs.some((c) => c.id === r.data.id)) await reload();
    void open(r.data.id!);
  };

  const addFriend = async (p: Person, note = "") => {
    const r = await post<{ friends?: boolean; error?: string }>("/requests", { to: p.id, note });
    if (!r.ok) return say(r.data.error ?? "That request could not be sent.");
    setPeople((ps) => ps.map((x) => (x.id === p.id ? { ...x, requested: !r.data.friends, friend: Boolean(r.data.friends) } : x)));
    say(r.data.friends ? `You and ${p.name} are friends now.` : `Request sent to ${p.name}.`);
  };

  const decide = async (rq: FriendRequest, action: "accept" | "decline" | "report") => {
    if (action === "report" && !confirm(`Report ${rq.from.name} for spam and block them?`)) return;
    const r = await post<{ error?: string }>(`/requests/${rq.id}`, { action, reason: "spam" });
    if (!r.ok) return say(r.data.error ?? "That did not work.");
    setRequests((rs) => (rs ?? []).filter((x) => x.id !== rq.id));
    setReqCount((n) => Math.max(0, n - 1));
    window.dispatchEvent(new Event("ec:messages"));
    say(action === "accept" ? `You and ${rq.from.name} are friends now.` : action === "report" ? "Reported and blocked. Thank you." : "Request declined.");
  };

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return convs.filter((c) => (tab === "friends" ? c.kind === "dm" : tab === "groups" ? c.kind === "group" : true) && (!term || c.name.toLowerCase().includes(term)));
  }, [convs, tab, q]);

  const other = thread?.conversation.kind === "dm" ? thread.members.find((p) => p.id !== me.id) : undefined;
  const typingNames = thread ? Object.keys(typing).filter((k) => k.startsWith(thread.conversation.id + ":")).map((k) => thread.members.find((p) => p.id === k.split(":")[1])?.name.split(" ")[0]).filter(Boolean) : [];
  const lastMine = thread ? [...thread.messages].reverse().find((m) => m.senderId === me.id) : undefined;
  const status = (m: Message) => {
    if (!thread || m.id !== lastMine?.id) return undefined;
    const readers = Object.entries(thread.readBy).filter(([, upto]) => upto >= m.id).length;
    if (thread.conversation.kind === "dm") return readers ? "Read" : "Sent";
    return readers ? `Read by ${readers}` : "Sent";
  };

  return (
    <main className={`msg${mobileChat ? " chat-open" : ""}`}>
      <section className="msg-list" aria-label="Chats">
        <div className="msg-list-h">
          <h1>Messages</h1>
          <button type="button" className="msg-new" aria-label="New message" onClick={() => setComposing(true)}><IconPen /></button>
        </div>
        <label className="msg-search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people and groups" aria-label="Search people and groups" maxLength={80} />
          {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search"><IconClose /></button>}
        </label>
        <div className="msg-tabs" role="tablist">
          {(["all", "friends", "groups", "requests"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "all" ? "All" : t === "friends" ? "Friends" : t === "groups" ? "Groups" : `Requests${reqCount ? ` ${reqCount}` : ""}`}
            </button>
          ))}
        </div>

        {people.length > 0 && (
          <div className="msg-people">
            <span className="msg-label">People</span>
            {people.map((p) => (
              <div key={p.id} className="msg-person">
                <Avatar id={p.id} name={p.name} size={36} online={p.online} />
                <span className="msg-person-t"><strong>{p.name}</strong><small>{[p.country && countryName(p.country), p.friend ? "Friend" : p.requested ? "Request sent" : ""].filter(Boolean).join(" · ")}</small></span>
                {p.friend ? <button type="button" className="msg-btn" onClick={() => void startDM(p.id)}>Message</button>
                  : p.requested ? <span className="msg-pill">Sent</span>
                  : <button type="button" className="msg-btn ghost" onClick={() => void addFriend(p)}>Add friend</button>}
              </div>
            ))}
          </div>
        )}

        {tab === "requests" ? (
          <div className="msg-reqs">
            {requests === null ? <p className="msg-empty">Loading…</p> : requests.length === 0 ? (
              <p className="msg-empty">No requests. People you meet in watch rooms can add you, and you can find friends by name or email above.</p>
            ) : requests.map((rq) => (
              <div key={rq.id} className={`msg-req${rq.spam ? " spam" : ""}`}>
                <div className="msg-req-r">
                  <Avatar id={rq.spam ? "unknown" : rq.from.id} name={rq.spam ? "? ?" : rq.from.name} size={36} />
                  <span className="msg-req-t">
                    <strong>{rq.spam ? "Unknown account" : `${rq.from.name.split(" ")[0]}${rq.from.country ? ` · ${countryName(rq.from.country)}` : ""}`}</strong>
                    <small>{rq.spam === "ai" ? "Flagged by AI as possible spam" : rq.spam === "rules" ? "Flagged as possible spam" : rq.note ? `“${rq.note}”` : [rq.room && `Was in your ${rq.room} room`, rq.mutual ? `${rq.mutual} friend${rq.mutual === 1 ? "" : "s"} in common` : ""].filter(Boolean).join(" · ") || "Wants to be friends"}</small>
                  </span>
                </div>
                <div className="msg-req-b">
                  <button type="button" className="msg-btn" onClick={() => void decide(rq, "accept")}>Accept</button>
                  <button type="button" className="msg-btn ghost" onClick={() => void decide(rq, "decline")}>Decline</button>
                  <button type="button" className="msg-btn ghost" onClick={() => void decide(rq, "report")}>Report</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="msg-convs">
            {shown.length === 0 && !people.length && (
              <p className="msg-empty">{q ? "No chats match." : tab === "groups" ? "No groups yet. Start one with the pen button." : "No chats yet. Find friends by name or email, or tap the pen to start a chat."}</p>
            )}
            {shown.map((c) => (
              <button key={c.id} type="button" className={`msg-conv${c.id === active ? " on" : ""}`} onClick={() => void open(c.id)} aria-current={c.id === active ? "true" : undefined}>
                <Avatar id={c.otherId || c.id} name={c.name} online={c.kind === "dm" && online.has(c.otherId ?? "")} group={c.kind === "group"} />
                <span className="msg-conv-t">
                  <span className="r"><strong>{c.name}</strong><time>{when(c.last?.createdAt ?? c.lastAt)}</time></span>
                  <span className="r2"><span>{Object.keys(typing).some((k) => k.startsWith(c.id + ":")) ? "typing…" : preview(c.last, me.id, c.kind === "group")}</span>{c.unread > 0 && <b>{c.unread > 99 ? "99+" : c.unread}</b>}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="msg-chat" aria-label="Chat">
        {!thread ? (
          <div className="msg-none"><p>{convs.length ? "Choose a chat to start." : "Your chats will show here."}</p></div>
        ) : (
          <>
            <header className="msg-chat-h">
              <button type="button" className="msg-back" onClick={() => { setMobileChat(false); history.replaceState(null, "", "/messages"); }} aria-label="Back to chats"><IconBack /></button>
              <div className="msg-chat-p">
                <Avatar id={other?.id ?? thread.conversation.id} name={thread.conversation.name} size={40} group={thread.conversation.kind === "group"} />
                <span>
                  <strong>{thread.conversation.name}</strong>
                  {other ? (
                    <small className={online.has(other.id) ? "on" : ""}>
                      {[other.country && countryName(other.country), online.has(other.id) ? "online" : "offline", other.languages.length ? `speaks ${other.languages.map(langName).join(", ")}` : ""].filter(Boolean).join(" · ")}
                    </small>
                  ) : (
                    <small>{thread.members.length} members · {thread.members.filter((p) => p.id !== me.id).map((p) => p.name.split(" ")[0]).slice(0, 4).join(", ")}{thread.members.length > 5 ? "…" : ""}</small>
                  )}
                </span>
              </div>
              <div className="msg-chat-r">
                <button type="button" className="msg-ic soon" disabled title="Voice calls are coming soon" aria-label="Voice call (coming soon)"><IconPhone /></button>
                <button type="button" className="msg-ic soon" disabled title="Video calls are coming soon" aria-label="Video call (coming soon)"><IconVideo /></button>
                <ChatMenu thread={thread} me={me} other={other} onDone={(msg, gone) => { say(msg); if (gone) { setThread(null); setActive(undefined); setMobileChat(false); void reload(); } else void open(thread.conversation.id, false); }} onError={say} />
              </div>
            </header>
            <div className="msg-msgs" ref={scroller}>
              {thread.more && (
                <button type="button" className="msg-older" onClick={async () => {
                  const r = await api<Thread>(`/c/${thread.conversation.id}?before=${thread.messages[0]?.id ?? 0}`);
                  if (r.ok) setThread((t) => (t ? { ...t, messages: [...r.data.messages, ...t.messages], more: r.data.more } : t));
                }}>Load earlier messages</button>
              )}
              {thread.messages.length === 0 && <p className="msg-empty center">Say hello to {thread.conversation.name.split(" ")[0]}.</p>}
              {thread.messages.map((m, i) => {
                const prev = thread.messages[i - 1];
                const day = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                return (
                  <div key={m.id} className="msg-item">
                    {day && <div className="msg-day">{dayLabel(m.createdAt)}</div>}
                    <Bubble m={m} mine={m.senderId === me.id} group={thread.conversation.kind === "group"} showName={day || prev?.senderId !== m.senderId}
                      status={status(m)} translated={translations[m.id]} onTranslate={thread.conversation.translate ? () => translate(m) : undefined}
                      onReport={async () => {
                        if (!confirm("Report this message to E-Cinema moderators?")) return;
                        const r = await post<{ error?: string }>(`/m/${m.id}/report`, { reason: "harassment" });
                        say(r.ok ? "Reported. A moderator will look." : r.data.error ?? "That report did not go through.");
                      }} />
                  </div>
                );
              })}
              {typingNames.length > 0 && <div className="msg-typing">{typingNames.join(", ")} {typingNames.length > 1 ? "are" : "is"} typing…</div>}
              <div className="msg-note"><span><IconLock />Encrypted in transit and at rest · auto-translate {thread.conversation.translate ? "on" : "off"}</span></div>
            </div>
            <Composer
              name={thread.conversation.kind === "dm" ? thread.conversation.name.split(" ")[0] : thread.conversation.name}
              parties={parties}
              disabled={other && !other.friend ? "You are no longer friends, so new messages are off." : undefined}
              onSend={send}
              onTyping={() => sendLive({ type: "typing", conversationId: thread.conversation.id })}
              onError={say}
            />
          </>
        )}
      </section>

      {composing && <NewChat me={me} onClose={() => setComposing(false)} onDM={startDM} onGroup={async (id) => { setComposing(false); await reload(); void open(id); }} onError={say} />}
      {toast && <div className="msg-toast" role="status">{toast}</div>}
    </main>
  );
}

function ChatMenu({ thread, me, other, onDone, onError }: { thread: Thread; me: Me; other?: Person; onDone: (msg: string, gone?: boolean) => void; onError: (m: string) => void }) {
  const [openMenu, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const c = thread.conversation;
  const act = async (fn: () => Promise<{ ok: boolean; data: { error?: string } }>, msg: string, gone?: boolean) => {
    setOpen(false);
    const r = await fn();
    if (!r.ok) return onError(r.data.error ?? "That did not work.");
    onDone(msg, gone);
  };
  return (
    <div className="msg-menu-w">
      <button type="button" className="msg-ic" aria-label="Chat options" aria-expanded={openMenu} onClick={() => setOpen((o) => !o)}><IconMore /></button>
      {openMenu && (
        <div className="msg-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => void act(() => post(`/c/${c.id}/translate`, { on: !c.translate }), c.translate ? "Auto-translate is off." : `Messages will show in ${langName(me.lang)}.`)}>
            {c.translate ? "Turn auto-translate off" : `Auto-translate into ${langName(me.lang)}`}
          </button>
          {c.kind === "group" && <button type="button" role="menuitem" onClick={() => { setOpen(false); setAdding(true); }}>Add friends</button>}
          {c.kind === "group" && <button type="button" role="menuitem" onClick={() => confirm(`Leave ${c.name}?`) && void act(() => post(`/c/${c.id}/leave`), `You left ${c.name}.`, true)}>Leave group</button>}
          {other && other.friend && <button type="button" role="menuitem" onClick={() => confirm(`Remove ${other.name} as a friend?`) && void act(() => api(`/friends/${other.id}`, { method: "DELETE" }), `${other.name} is no longer a friend.`)}>Remove friend</button>}
          {other && <button type="button" role="menuitem" className="danger" onClick={() => confirm(`Block ${other.name}? They will not be able to reach you.`) && void act(() => post("/blocks", { id: other.id }), `${other.name} is blocked.`)}>Block</button>}
        </div>
      )}
      {adding && <NewChat me={me} addTo={c.id} exclude={thread.members.map((p) => p.id)} onClose={() => setAdding(false)} onDM={async () => {}} onGroup={async () => { setAdding(false); onDone("Friends added."); }} onError={onError} />}
    </div>
  );
}

function NewChat({ me, addTo, exclude = [], onClose, onDM, onGroup, onError }: {
  me: Me; addTo?: string; exclude?: string[]; onClose: () => void; onDM: (id: string) => Promise<void>; onGroup: (id: string) => Promise<void>; onError: (m: string) => void;
}) {
  const [friends, setFriends] = useState<Person[] | null>(null);
  const [group, setGroup] = useState(Boolean(addTo));
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  useEffect(() => { void api<{ friends: Person[] }>("/friends").then((r) => setFriends(r.ok ? r.data.friends.filter((f) => !exclude.includes(f.id)) : [])); }, [exclude]);
  const list = (friends ?? []).filter((f) => f.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const create = async () => {
    const members = [...picked];
    const r = addTo ? await post<{ error?: string }>(`/c/${addTo}/members`, { members }) : await post<{ id?: string; error?: string }>("/groups", { name, members });
    if (!r.ok) return onError(r.data.error ?? "That group could not be made.");
    await onGroup(addTo ?? (r.data as { id: string }).id);
  };
  return (
    <div className="msg-modal" role="dialog" aria-modal="true" aria-label={addTo ? "Add friends" : "New message"} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="msg-modal-b">
        <div className="msg-modal-h"><strong>{addTo ? "Add friends" : group ? "New group" : "New message"}</strong><button type="button" onClick={onClose} aria-label="Close"><IconClose /></button></div>
        {!addTo && (
          <div className="msg-tabs">
            <button type="button" className={!group ? "on" : ""} onClick={() => setGroup(false)}>Friend</button>
            <button type="button" className={group ? "on" : ""} onClick={() => setGroup(true)}>Group</button>
          </div>
        )}
        {group && !addTo && <input className="msg-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Group name, e.g. UNILAG Film Club" aria-label="Group name" />}
        <input className="msg-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your friends" aria-label="Search your friends" />
        <div className="msg-pick">
          {friends === null ? <p className="msg-empty">Loading…</p> : list.length === 0 ? (
            <p className="msg-empty">{friends.length ? "No friends match." : "No friends yet. Search for people by name or email in Messages and add them."}</p>
          ) : list.map((f) => (
            group ? (
              <label key={f.id} className="msg-person">
                <Avatar id={f.id} name={f.name} size={36} online={f.online} />
                <span className="msg-person-t"><strong>{f.name}</strong><small>{f.country ? countryName(f.country) : ""}</small></span>
                <input type="checkbox" checked={picked.has(f.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
              </label>
            ) : (
              <button key={f.id} type="button" className="msg-person" onClick={() => void onDM(f.id)}>
                <Avatar id={f.id} name={f.name} size={36} online={f.online} />
                <span className="msg-person-t"><strong>{f.name}</strong><small>{f.online ? "online" : f.country ? countryName(f.country) : ""}</small></span>
              </button>
            )
          ))}
        </div>
        {group && <button type="button" className="msg-btn wide" disabled={!picked.size || (!addTo && !name.trim())} onClick={() => void create()}>{addTo ? `Add ${picked.size || ""}` : `Create group${picked.size ? ` with ${picked.size}` : ""}`}</button>}
        <p className="msg-fine">Signed in as {me.name}.</p>
      </div>
    </div>
  );
}
