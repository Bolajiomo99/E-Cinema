"use client";

import { useRef, useState } from "react";
import Avatar from "@/components/messages/Avatar";
import type { Group, Post } from "@/lib/community-types";
import { call } from "./PostCard";

// "Share a thought, clip, poll or snack photo…" (Figma 32:875). Clips arrive with the Clips page.
const DURATIONS = [[1, "1 hour"], [3, "3 hours"], [24, "1 day"], [72, "3 days"], [168, "1 week"]] as const;

export default function Composer({ me, groups, group, onPosted, say }: {
  me: { id: string; name: string }; groups: Group[]; group?: string; onPosted: (p: Post) => void; say: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [to, setTo] = useState(group ?? "");
  const [poll, setPoll] = useState<string[] | null>(null);
  const [hours, setHours] = useState(24);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setText(""); setPoll(null); setHours(24); setOpen(false);
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
  };
  const ready = !busy && (poll ? text.trim() && poll.filter((o) => o.trim()).length >= 2 : photo || text.trim());

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    let mediaKey = "";
    if (photo) {
      const f = new FormData();
      f.set("file", photo.file);
      const r = await fetch("/api/community/photo", { method: "POST", body: f });
      const j = (await r.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!r.ok || !j.key) { setBusy(false); return say(j.error ?? "The photo could not be uploaded"); }
      mediaKey = j.key;
    }
    const r = await call<Post & { error?: string }>("posts", {
      community: to, kind: poll ? "poll" : photo ? "photo" : "text", body: text, mediaKey,
      options: poll?.map((o) => o.trim()).filter(Boolean), pollHours: poll ? hours : 0,
    });
    setBusy(false);
    if (!r.ok) return say(r.data.error ?? "Your post could not be shared");
    onPosted(r.data);
    reset();
  };

  return (
    <div className={`cm-compose ${open ? "open" : ""}`}>
      <div className="cm-compose-row">
        <Avatar id={me.id} name={me.name} size={40} />
        {open ? (
          <textarea ref={area} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} autoFocus
            placeholder={poll ? "Ask a question…" : "Share a thought, clip, poll or snack photo…"} aria-label="Write a post" />
        ) : (
          <button type="button" className="cm-compose-ph" onClick={() => setOpen(true)}>Share a thought, clip, poll or snack photo…</button>
        )}
        {!open && <button type="button" className="cm-btn" onClick={() => setOpen(true)}>Post</button>}
      </div>
      {open && (
        <>
          {photo && (
            <div className="cm-compose-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Your photo" />
              <button type="button" onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null); }} aria-label="Remove photo">×</button>
            </div>
          )}
          {poll && (
            <div className="cm-compose-poll">
              {poll.map((o, i) => (
                <div key={i} className="cm-compose-opt">
                  <input value={o} maxLength={80} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} onChange={(e) => setPoll((p) => p!.map((x, j) => (j === i ? e.target.value : x)))} />
                  {poll.length > 2 && <button type="button" onClick={() => setPoll((p) => p!.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>×</button>}
                </div>
              ))}
              <div className="cm-compose-opt-row">
                {poll.length < 6 && <button type="button" className="cm-link" onClick={() => setPoll((p) => [...p!, ""])}>+ Add option</button>}
                <label>Poll length <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{DURATIONS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></label>
              </div>
            </div>
          )}
          <div className="cm-compose-tools">
            <button type="button" onClick={() => file.current?.click()} disabled={Boolean(poll)} aria-label="Add a photo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg>
              <span>Photo</span>
            </button>
            <button type="button" onClick={() => setPoll((p) => (p ? null : ["", ""]))} disabled={Boolean(photo)} aria-pressed={Boolean(poll)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
              <span>Poll</span>
            </button>
            <span className="soon" title="Clips are coming soon" aria-disabled="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
              <span>Clip · soon</span>
            </span>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > 8 << 20) return say("That photo is too big (up to 8 MB)");
              setPhoto({ file: f, url: URL.createObjectURL(f) });
            }} />
            <span className="cm-sp" />
            {!group && (
              <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Post to">
                <option value="">Everyone</option>
                {groups.filter((g) => g.joined).map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
              </select>
            )}
            <button type="button" className="cm-btn ghost" onClick={reset}>Cancel</button>
            <button type="button" className="cm-btn" onClick={submit} disabled={!ready}>{busy ? "Posting…" : "Post"}</button>
          </div>
          <p className="cm-fine">Be kind. No spoilers before the credits roll, and never share pirated film.</p>
        </>
      )}
    </div>
  );
}
