"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

// The watch room's side panel (Figma 17:562 Room, 95:1008 World chat, 95:1269 Polls):
// the party's own chat, who of the party is here, world chat translated into the viewer's
// language, polls, voice notes and files, and the free talk-time allowance.

export type Media = { key: string; type: string; size: number; seconds?: number; transcript?: boolean; name?: string; critic?: { score: number; line: string } };
export type ChatMessage = {
  id: number; name: string; body: string; mine?: boolean; createdAt: string;
  scope?: "room" | "world"; lang?: string; country?: string; kind?: "text" | "voice" | "image" | "file"; media?: Media; spoiler?: boolean;
};
export type Friend = { name: string; country?: string; host?: boolean; online: boolean; me?: boolean };
export type Party = { id: string; code: string; name: string; rules: string[]; members: Friend[] };
export type Poll = { id: number; scope: "room" | "world"; question: string; options: { text: string; votes: number }[]; votes: number; languages: number; mine?: number };

type Tab = "room" | "friends" | "world" | "polls";
const REACTIONS = ["🔥", "😂", "😮", "❤️", "👏", "😭"];
const EMOJI = ["😀", "😂", "😍", "😮", "😢", "😡", "👏", "🔥", "❤️", "🍿", "🎬", "🙌"];
const FREE_TALK = 300;
const MAX_NOTE = 120;
const COLORS = ["#2bb3a3", "#f5a524", "#3b82f6", "#8b7cf6", "#e3182d", "#22a35a", "#db2777", "#0ea5e9"];

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const colorOf = (n: string) => COLORS[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const base = (l?: string) => (l || "").split("-")[0].toLowerCase();

function countryName(cc?: string) {
  if (!cc) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

export default function SidePanel(props: {
  showtimeId: string; film: string; watching: number; online: boolean; notice: string;
  party: Party | null; onlineNames: string[] | null;
  roomMessages: ChatMessage[]; worldMessages: ChatMessage[]; polls: Poll[];
  lang: string; talkLeft: number; onTalkLeft: (n: number) => void;
  send: (payload: object) => boolean;
}) {
  const { showtimeId, party, lang } = props;
  const [tab, setTab] = useState<Tab>(party ? "room" : "world");
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [spoilers, setSpoilers] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const asked = useRef<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scope: "room" | "world" = tab === "world" || !party ? "world" : "room";
  const shown = tab === "room" ? props.roomMessages : props.worldMessages;
  const filterSpoilers = tab === "world" || Boolean(party?.rules.includes("spoiler-filter"));

  // Ask for translations of world messages written in another language, a batch at a time.
  useEffect(() => {
    const todo = props.worldMessages
      .filter((m) => (m.kind ?? "text") !== "image" && m.kind !== "file" && base(m.lang) !== base(lang) && !asked.current.has(m.id) && !(m.kind === "voice" && !m.media?.transcript))
      .map((m) => m.id)
      .slice(-40);
    if (!todo.length) return;
    todo.forEach((id) => asked.current.add(id));
    const t = setTimeout(async () => {
      const r = await fetch(`/api/rooms/${showtimeId}/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: todo }) }).catch(() => null);
      if (!r?.ok) return;
      const b = (await r.json()) as { items: Record<string, string>; spoilers?: number[]; paused?: boolean };
      setTranslations((x) => ({ ...x, ...Object.fromEntries(Object.entries(b.items).map(([k, v]) => [Number(k), v])) }));
      if (b.spoilers?.length) setSpoilers((s) => new Set([...s, ...b.spoilers!]));
      setPaused(Boolean(b.paused));
    }, 600);
    return () => clearTimeout(t);
  }, [props.worldMessages, lang, showtimeId]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [shown, tab]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab]);

  const flash = (m: string) => {
    setErr(m);
    setTimeout(() => setErr(""), 4000);
  };

  const sendText = (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    if (props.send({ type: "msg", body, scope })) {
      setDraft("");
      setEmojiOpen(false);
      if (tab === "friends" || tab === "polls") setTab(scope === "room" ? "room" : "world");
    } else flash("Not connected yet. Try again in a moment.");
  };

  const upload = async (file: Blob, kind: "voice" | "image" | "file", extra: Record<string, string> = {}, name = "upload") => {
    setBusy(true);
    const form = new FormData();
    form.append("file", file, name);
    form.append("kind", kind);
    form.append("scope", scope);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    const r = await fetch(`/api/rooms/${showtimeId}/media`, { method: "POST", body: form }).catch(() => null);
    setBusy(false);
    const b = r ? ((await r.json().catch(() => ({}))) as { error?: string; talkLeft?: number }) : {};
    if (!r?.ok) return flash(b.error ?? "Could not share that. Try again.");
    if (kind === "voice" && typeof b.talkLeft === "number") props.onTalkLeft(b.talkLeft);
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type === "application/pdf") upload(f, "file", {}, f.name);
    else if (/^image\/(jpeg|png|webp)$/.test(f.type)) upload(f, "image", draft.trim() ? { caption: draft.trim() } : {}, f.name).then(() => setDraft(""));
    else flash("Share a photo (JPG, PNG, WebP) or a PDF.");
  };

  const free = props.talkLeft >= 0;
  const muted = free && props.talkLeft <= 0;
  const friendsHere = party ? party.members.filter((m) => (props.onlineNames ? props.onlineNames.includes(m.name) : m.online)).length : 0;

  const invite = async () => {
    if (!party) return;
    const url = `${location.origin}/p/${party.code}`;
    try {
      if (navigator.share) await navigator.share({ title: party.name, text: `Watch ${props.film} with us`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* closed the share sheet */
    }
  };

  return (
    <aside className="room-side rp">
      <header className="rp-head">
        <div className="rp-title">
          <div>
            <strong>{party ? `Room · ${party.name}` : `World premiere · ${props.film}`}</strong>
            <span>
              {props.watching.toLocaleString()} here{party ? ` · ${friendsHere} ${friendsHere === 1 ? "friend" : "friends"}` : ""}
              {props.online ? "" : " · reconnecting"}
            </span>
          </div>
          {party ? (
            <button type="button" className="rp-btn" onClick={invite}>{copied ? "Copied" : "Invite"}</button>
          ) : (
            <Link className="rp-btn" href={`/parties/new?film=${showtimeId}`}>Start a party</Link>
          )}
        </div>
        <div className="rp-tabs" role="tablist">
          {(["room", "friends", "world", "polls"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "room" ? "Room" : t === "friends" ? "Friends" : t === "world" ? "World chat" : "Polls"}
            </button>
          ))}
        </div>
      </header>

      <div className="rp-body" ref={listRef}>
        {tab === "world" && (
          <p className="rp-note">
            {props.watching.toLocaleString()} {props.watching === 1 ? "person" : "people"} in world chat · {paused ? "translation is paused, messages show as written" : "everyone reads it in their own language"}
          </p>
        )}

        {(tab === "room" || tab === "world") && (
          <>
            {tab === "room" && !party && <NoParty showtimeId={showtimeId} />}
            {(tab === "world" || party) && shown.length === 0 && <p className="rp-empty">No messages yet. Say hello{tab === "room" ? " to your party" : " to the world"}.</p>}
            {shown.map((m) => {
              const hidden = filterSpoilers && (m.spoiler || spoilers.has(m.id)) && !m.mine && !revealed.has(m.id);
              const tr = tab === "world" && base(m.lang) !== base(lang) ? translations[m.id] : undefined;
              return (
                <Msg key={m.id} m={m} showtimeId={showtimeId} world={tab === "world"} translated={tr} hidden={hidden}
                  onReveal={() => setRevealed((s) => new Set(s).add(m.id))} onReport={() => setReporting(m)} />
              );
            })}
          </>
        )}

        {tab === "friends" && (party ? (
          <ul className="rp-friends">
            {party.members.map((f, i) => {
              const on = props.onlineNames ? props.onlineNames.includes(f.name) : f.online;
              return (
                <li key={`${f.name}-${i}`}>
                  <span className="rp-av" style={{ background: colorOf(f.name) }}>{initials(f.name)}<i className={on ? "on" : ""} /></span>
                  <div><b>{f.name}</b><small>{[f.host ? "Host" : "", countryName(f.country)].filter(Boolean).join(" · ") || "Party member"}</small></div>
                  <em className={on ? "on" : ""}>{on ? "Watching" : "Not here yet"}</em>
                </li>
              );
            })}
          </ul>
        ) : <NoParty showtimeId={showtimeId} />)}

        {tab === "polls" && <Polls polls={props.polls} party={party} send={props.send} onError={flash} />}
      </div>

      <div className="rp-reacts">
        {REACTIONS.map((r) => (
          <button key={r} onClick={() => props.send({ type: "react", emoji: r })} aria-label={`React ${r}`}>{r}</button>
        ))}
      </div>

      {free && (
        <div className={`rp-talk ${muted ? "out" : ""}`}>
          <div className="rp-talk-row">
            <MicIcon small />
            <span>{muted ? "Talk time used · you are muted" : `Free talk time: ${mmss(props.talkLeft)} left`}</span>
            <Link href="/plans">Go Pro</Link>
          </div>
          <div className="rp-talk-bar"><span style={{ width: `${(props.talkLeft / FREE_TALK) * 100}%` }} /></div>
          <p>{muted ? "Upgrade to Pro to keep talking, send voice notes, images and documents in this room." : "Free members can talk for 5 minutes per premiere, then stay muted until they upgrade. Reactions stay free."}</p>
        </div>
      )}

      {(err || props.notice) && <p className="room-notice">{err || props.notice}</p>}
      {reporting && (
        <ReportDialog name={reporting.name} onClose={() => setReporting(null)}
          onSend={(reason, block) => {
            if (props.send({ type: "report", message: reporting.id, reason, block })) setReporting(null);
            else flash("Not connected yet. Try again in a moment.");
          }} />
      )}

      <form className="rp-compose" onSubmit={sendText}>
        <button type="button" className="rp-icon" onClick={() => fileRef.current?.click()} disabled={busy || muted || (tab === "room" && !party)} aria-label="Share a photo or PDF">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
        </button>
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={pickFile} />
        <input
          value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} aria-label="Message the room"
          placeholder={scope === "world" ? "Message the world · auto-translated" : "Message the room"}
          disabled={muted || (tab === "room" && !party)}
        />
        <button type="button" className="rp-icon" onClick={() => setEmojiOpen((x) => !x)} aria-label="Emoji" aria-expanded={emojiOpen}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9.5" /><path d="M8 14.5s1.5 2 4 2 4-2 4-2" /><circle cx="9" cy="9.5" r=".6" fill="currentColor" /><circle cx="15" cy="9.5" r=".6" fill="currentColor" /></svg>
        </button>
        {draft.trim() ? (
          <button className="rp-mic send" aria-label="Send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
          </button>
        ) : (
          <VoiceButton disabled={busy || muted || (tab === "room" && !party)} limit={free ? Math.min(MAX_NOTE, props.talkLeft) : MAX_NOTE}
            onNote={(blob, secs) => upload(blob, "voice", { seconds: String(secs) }, "note")} onError={flash} />
        )}
        {emojiOpen && (
          <div className="rp-emoji">
            {EMOJI.map((e) => <button type="button" key={e} onClick={() => setDraft((d) => (d + e).slice(0, 500))}>{e}</button>)}
          </div>
        )}
      </form>
    </aside>
  );
}

function NoParty({ showtimeId }: { showtimeId: string }) {
  return (
    <div className="rp-noparty">
      <b>Watch with your people</b>
      <p>Start a party or join one from an invite link. Your party gets its own room chat, polls and a friends list.</p>
      <Link className="rp-btn" href={`/parties/new?film=${showtimeId}`}>Start a party</Link>
    </div>
  );
}

function Msg({ m, showtimeId, world, translated, hidden, onReveal, onReport }: {
  m: ChatMessage; showtimeId: string; world: boolean; translated?: string; hidden: boolean; onReveal: () => void; onReport: () => void;
}) {
  const kind = m.kind ?? "text";
  const src = m.media ? `/api/rooms/${showtimeId}/media?key=${encodeURIComponent(m.media.key)}` : "";
  const name = m.mine ? "You" : m.name;
  const place = countryName(m.country);
  return (
    <div className={`rp-msg ${m.mine ? "mine" : ""}`}>
      <span className="rp-av" style={{ background: m.mine ? "#e3182d" : colorOf(m.name) }} aria-hidden>{initials(m.name)}</span>
      <div className="rp-c">
        <div className="rp-meta">
          <b>{world && place ? `${name} · ${place}` : name}</b>
          {world && m.lang ? <span className="rp-lang">{base(m.lang).toUpperCase()}</span> : !world && place ? <small>{place}</small> : null}
          {!m.mine && (
            <button type="button" className="rp-more" onClick={onReport} aria-label={`Report or block ${m.name}`} title="Report or block">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
          )}
        </div>
        {hidden ? (
          <button type="button" className="rp-spoiler" onClick={onReveal}>Spoiler hidden · tap to show</button>
        ) : kind === "voice" && m.media ? (
          <>
            <VoiceNote src={src} seconds={m.media.seconds ?? 0} />
            {m.media.transcript && <small className="rp-sub">Auto-transcript: “{translated ?? m.body}”</small>}
          </>
        ) : kind === "image" && m.media ? (
          <>
            <a className="rp-img" href={src} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={m.body === "Photo" ? `Photo from ${m.name}` : m.body} loading="lazy" />
              {m.media.critic && <span className="rp-critic">✷ Snack critic: {m.media.critic.score.toFixed(1)} · {m.media.critic.line}</span>}
            </a>
            {m.body !== "Photo" && <p translate="no">{m.body}</p>}
          </>
        ) : kind === "file" && m.media ? (
          <a className="rp-file" href={src} target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>
            <span><b>{m.media.name ?? m.body}</b><small>PDF · {(m.media.size / 1048576).toFixed(1)} MB</small></span>
          </a>
        ) : (
          <>
            <p translate="no">{translated ?? m.body}</p>
            {translated && translated !== m.body && <small className="rp-sub">Original: {m.body}</small>}
          </>
        )}
      </div>
    </div>
  );
}

const BARS = [6, 12, 18, 10, 22, 14, 8, 16, 20, 12, 6, 14, 18, 8, 12, 16, 10, 6];

function VoiceNote({ src, seconds }: { src: string; seconds: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const toggle = () => {
    audio.current ??= Object.assign(new Audio(src), { preload: "none" });
    const a = audio.current;
    a.ontimeupdate = () => setAt(a.currentTime);
    a.onended = () => { setPlaying(false); setAt(0); };
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    else { a.pause(); setPlaying(false); }
  };
  useEffect(() => () => audio.current?.pause(), []);
  const progress = seconds ? at / seconds : 0;
  return (
    <div className="rp-voice">
      <button type="button" onClick={toggle} aria-label={playing ? "Pause voice note" : "Play voice note"}>
        {playing ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1" width="3" height="10" /><rect x="7" y="1" width="3" height="10" /></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.5v9l7.5-4.5z" /></svg>}
      </button>
      <span className="rp-wave" aria-hidden>
        {BARS.map((h, i) => <i key={i} style={{ height: h, opacity: i / BARS.length < progress ? 1 : 0.55 }} />)}
      </span>
      <small>{mmss(playing ? at : seconds)}</small>
    </div>
  );
}

function VoiceButton({ disabled, limit, onNote, onError }: { disabled: boolean; limit: number; onNote: (b: Blob, secs: number) => void; onError: (m: string) => void }) {
  const [rec, setRec] = useState<{ r: MediaRecorder; started: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const stopAt = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs((Date.now() - rec.started) / 1000), 250);
    return () => clearInterval(t);
  }, [rec]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return onError("This browser cannot record voice notes.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError("Allow the microphone to send a voice note.");
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: BlobPart[] = [];
    const started = Date.now();
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(stopAt.current);
      setRec(null);
      setSecs(0);
      const len = Math.max(1, Math.round((Date.now() - started) / 1000));
      if (len < 1 || !chunks.length) return;
      onNote(new Blob(chunks, { type: r.mimeType || "audio/webm" }), Math.min(len, Math.max(1, limit)));
    };
    r.start();
    setRec({ r, started });
    stopAt.current = setTimeout(() => r.state === "recording" && r.stop(), Math.max(1, limit) * 1000);
  };

  return (
    <button
      type="button" className={`rp-mic ${rec ? "rec" : ""}`} disabled={disabled && !rec}
      onClick={() => (rec ? rec.r.stop() : start())}
      aria-label={rec ? `Stop and send voice note (${mmss(secs)})` : "Record a voice note"}
    >
      {rec ? <span className="rp-rec">{mmss(secs)}</span> : <MicIcon />}
    </button>
  );
}

function MicIcon({ small }: { small?: boolean }) {
  const s = small ? 16 : 20;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" /></svg>
  );
}

function Polls({ polls, party, send, onError }: { polls: Poll[]; party: Party | null; send: (p: object) => boolean; onError: (m: string) => void }) {
  const [making, setMaking] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState(["", ""]);
  const sorted = useMemo(() => [...polls].sort((a, b) => (a.scope === b.scope ? b.id - a.id : a.scope === "room" ? -1 : 1)), [polls]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const options = opts.map((o) => o.trim()).filter(Boolean);
    if (!q.trim() || options.length < 2) return onError("A poll needs a question and at least 2 answers.");
    if (send({ type: "poll", question: q.trim(), options })) {
      setMaking(false);
      setQ("");
      setOpts(["", ""]);
    } else onError("Not connected yet. Try again in a moment.");
  };

  return (
    <div className="rp-polls">
      {sorted.map((p) => (
        <div key={p.id} className="rp-poll">
          <b>{p.scope === "world" ? `World poll: ${p.question.charAt(0).toLowerCase()}${p.question.slice(1)}` : p.question}</b>
          {p.options.map((o, i) => {
            const pct = p.votes ? Math.round((o.votes / p.votes) * 100) : 0;
            return (
              <button key={i} type="button" className={p.mine === i ? "on" : ""} onClick={() => send({ type: "vote", poll: p.id, choice: i })} aria-pressed={p.mine === i}>
                <span className="fill" style={{ width: `${pct}%` }} />
                <span>{o.text}</span>
                <em>{pct}%</em>
              </button>
            );
          })}
          <small>
            {p.scope === "room" ? `Room poll · ${p.votes} ${p.votes === 1 ? "vote" : "votes"} · closes at the credits` : `World · ${p.votes.toLocaleString()} ${p.votes === 1 ? "vote" : "votes"} in ${p.languages} ${p.languages === 1 ? "language" : "languages"}`}
          </small>
        </div>
      ))}
      {party ? (
        making ? (
          <form className="rp-poll rp-newpoll" onSubmit={create}>
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={120} placeholder="Ask your party" aria-label="Poll question" autoFocus />
            {opts.map((o, i) => (
              <input key={i} value={o} maxLength={60} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
                onChange={(e) => setOpts((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <div className="rp-row">
              {opts.length < 4 && <button type="button" className="rp-btn ghost" onClick={() => setOpts((l) => [...l, ""])}>Add answer</button>}
              <span style={{ flex: 1 }} />
              <button type="button" className="rp-btn ghost" onClick={() => setMaking(false)}>Cancel</button>
              <button className="rp-btn red">Start</button>
            </div>
          </form>
        ) : (
          <button type="button" className="rp-btn" onClick={() => setMaking(true)}>Start a poll</button>
        )
      ) : (
        <p className="rp-empty">Start a party to run polls with your friends. Everyone can vote in the world poll.</p>
      )}
    </div>
  );
}

const REASONS: [string, string][] = [
  ["harassment", "Harassment or bullying"], ["hate", "Hate speech"], ["spoilers", "Spoilers in world chat"], ["spam", "Selling or spam"],
  ["recording", "Recording the screen"], ["under13", "Someone under 13"], ["other", "Something else"],
];

// Report and block (Figma 96:1378).
function ReportDialog({ name, onClose, onSend }: { name: string; onClose: () => void; onSend: (reason: string, block: boolean) => void }) {
  const [reason, setReason] = useState("harassment");
  const [block, setBlock] = useState(true);
  const first = name.split(/\s+/)[0] || name;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="rd-back" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="rd" role="dialog" aria-modal="true" aria-labelledby="rd-title" onSubmit={(e) => { e.preventDefault(); onSend(reason, block); }}>
        <span className="rd-icon" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 21V4m0 0h11l-2 4 2 4H5" /></svg>
        </span>
        <h2 id="rd-title">Report {first}?</h2>
        <p>Reports are private. {first} will not know it was you.</p>
        <div className="rd-list" role="radiogroup" aria-label="Reason">
          {REASONS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={reason === k} className={reason === k ? "on" : ""} onClick={() => setReason(k)}>
              <span>{label}</span>
              {reason === k && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
            </button>
          ))}
        </div>
        <label className="rd-block">
          <span><b>Also block {first}</b><small>You will not see their messages or rooms</small></span>
          <input type="checkbox" role="switch" checked={block} onChange={(e) => setBlock(e.target.checked)} />
        </label>
        <div className="rd-actions">
          <button className="rd-send">Send report</button>
          <button type="button" className="rd-cancel" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
