"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Party } from "@/lib/chat-types";
import { IconImage, IconMic, IconPlus, IconSend, IconSmile, IconTrash } from "./icons";

const EMOJI = ["😂", "😍", "🔥", "👏", "😭", "😮", "🙏", "❤️", "🍿", "🎬", "🎉", "👀", "😅", "🤣", "💯", "🥹", "😎", "🤝", "👍", "🙌", "😢", "😡", "🤯", "✨"];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export type Outgoing =
  | { kind: "text"; body: string }
  | { kind: "party"; partyCode: string; body: string }
  | { kind: "voice"; blob: Blob; durationMs: number }
  | { kind: "photo"; file: File; body: string };

export default function Composer({ name, parties, disabled, onSend, onTyping, onError }: {
  name: string; parties: Party[]; disabled?: string; onSend: (o: Outgoing) => Promise<boolean>; onTyping: () => void; onError: (m: string) => void;
}) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<"" | "emoji" | "party">("");
  const [rec, setRec] = useState<{ r: MediaRecorder; started: number; cancel: boolean } | null>(null);
  const [secs, setSecs] = useState(0);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stopAt = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : ""), [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs((Date.now() - rec.started) / 1000), 250);
    return () => clearInterval(t);
  }, [rec]);

  const send = async (o: Outgoing) => {
    setBusy(true);
    const ok = await onSend(o);
    setBusy(false);
    return ok;
  };

  const submit = async () => {
    const body = text.trim();
    if (photo) {
      if (await send({ kind: "photo", file: photo, body })) { setPhoto(null); setText(""); }
      return;
    }
    if (!body) return;
    setText("");
    if (!(await send({ kind: "text", body }))) setText(body);
    input.current?.focus();
  };

  const record = async () => {
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
    const state = { r, started, cancel: false };
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(stopAt.current);
      setRec(null);
      setSecs(0);
      const ms = Date.now() - started;
      if (state.cancel || ms < 700 || !chunks.length) return;
      void send({ kind: "voice", blob: new Blob(chunks, { type: r.mimeType || "audio/webm" }), durationMs: Math.min(ms, 300_000) });
    };
    r.start();
    setRec(state);
    stopAt.current = setTimeout(() => r.state === "recording" && r.stop(), 300_000);
  };

  if (disabled) return <div className="msg-composer off"><p>{disabled}</p></div>;

  return (
    <div className="msg-composer">
      {menu === "emoji" && (
        <div className="msg-pop emoji" role="menu">
          {EMOJI.map((e) => <button key={e} type="button" onClick={() => { setText((t) => t + e); setMenu(""); input.current?.focus(); }}>{e}</button>)}
        </div>
      )}
      {menu === "party" && (
        <div className="msg-pop party" role="menu">
          <strong>Share a watch party</strong>
          {parties.length ? parties.map((p) => (
            <button key={p.code} type="button" onClick={async () => { setMenu(""); await send({ kind: "party", partyCode: p.code, body: "Want to join my party?" }); }}>
              <span>{p.film}</span><small>{p.name} · {new Date(p.startsAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</small>
            </button>
          )) : <p>Join or start a party first, then share it here. <a href="/parties">Watch parties</a></p>}
        </div>
      )}
      {photo && (
        <div className="msg-attach">
          <img src={preview} alt="" />
          <span>{photo.name}</span>
          <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo"><IconTrash /></button>
        </div>
      )}
      <div className="msg-composer-row">
        {rec ? (
          <>
            <button type="button" className="msg-ic" aria-label="Cancel voice note" onClick={() => { rec.cancel = true; rec.r.stop(); }}><IconTrash /></button>
            <div className="msg-field rec"><i />Recording {mmss(secs)}</div>
            <button type="button" className="msg-mic rec" aria-label="Stop and send voice note" onClick={() => rec.r.stop()}><IconSend /></button>
          </>
        ) : (
          <>
            <button type="button" className="msg-ic" aria-label="Share a watch party" aria-expanded={menu === "party"} onClick={() => setMenu((m) => (m === "party" ? "" : "party"))}><IconPlus /></button>
            <button type="button" className="msg-ic" aria-label="Send a photo" onClick={() => file.current?.click()}><IconImage /></button>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 8 << 20) return onError("Photos can be up to 8 MB.");
              setPhoto(f);
            }} />
            <label className="msg-field">
              <span className="sr-only">Message {name}</span>
              <textarea ref={input} rows={1} value={text} maxLength={2000} placeholder={photo ? "Add a caption" : `Message ${name}`}
                onChange={(e) => { setText(e.target.value); onTyping(); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
            </label>
            <button type="button" className="msg-ic" aria-label="Add an emoji" aria-expanded={menu === "emoji"} onClick={() => setMenu((m) => (m === "emoji" ? "" : "emoji"))}><IconSmile /></button>
            {text.trim() || photo ? (
              <button type="button" className="msg-mic" aria-label="Send" disabled={busy} onClick={() => void submit()}><IconSend /></button>
            ) : (
              <button type="button" className="msg-mic" aria-label="Record a voice note" disabled={busy} onClick={() => void record()}><IconMic /></button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
