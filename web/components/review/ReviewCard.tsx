"use client";

import Link from "next/link";
import { useState } from "react";

export const TAGS: [string, string][] = [
  ["great-story", "Great story"], ["amazing-music", "Amazing music"], ["too-long", "Too long"],
  ["great-dub", "Great dub"], ["scary", "Scary"], ["would-rewatch", "Would rewatch"],
];

// "How was it?" (Figma 96:1302).
export default function ReviewCard({ showtimeId, eyebrow, initial, next, compact }: {
  showtimeId: string; eyebrow: string; initial?: { stars: number; tags: string[]; body: string } | null;
  next?: { text: string; href: string; cta: string } | null; compact?: boolean;
}) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [body, setBody] = useState(initial?.body ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">(initial ? "saved" : "idle");
  const [err, setErr] = useState("");

  const post = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stars) return setErr("Tap the stars to rate the film.");
    setErr("");
    setState("saving");
    const r = await fetch(`/api/reviews/${showtimeId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ stars, tags, body }) }).catch(() => null);
    const b = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
    if (!r?.ok) {
      setState("idle");
      return setErr(b.error ?? "Could not post your review. Try again.");
    }
    setState("saved");
  };

  const shown = hover || stars;
  return (
    <form className={`rv ${compact ? "compact" : ""}`} onSubmit={post}>
      <p className="rv-eyebrow">{eyebrow}</p>
      <h1>How was it?</h1>
      <div className="rv-stars" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)} onClick={() => { setStars(n); setState("idle"); }} className={n <= shown ? "on" : ""}>
            <svg width="34" height="34" viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" strokeWidth="1.3" strokeLinejoin="round" /></svg>
          </button>
        ))}
      </div>
      <div className="rv-tags">
        {TAGS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={tags.includes(k)} className={tags.includes(k) ? "on" : ""}
            onClick={() => { setTags((t) => (t.includes(k) ? t.filter((x) => x !== k) : [...t, k])); setState("idle"); }}>{label}</button>
        ))}
      </div>
      <label className="rv-label" htmlFor="rv-body">Write a review (optional)</label>
      <input id="rv-body" className="rv-body" value={body} maxLength={500} onChange={(e) => { setBody(e.target.value); setState("idle"); }} placeholder="Watched with friends across three countries…" />
      <div className="rv-foot">
        <p>{err || (state === "saved" ? "Thanks. Your review is posted and the studio can see what you loved." : "Your rating helps others and tells the studio what you loved.")}</p>
        <button className="rv-post" disabled={state === "saving"}>{state === "saved" ? "Update review" : state === "saving" ? "Posting…" : "Post review"}</button>
      </div>
      {next && (
        <div className="rv-next">
          <span>{next.text}</span>
          <Link href={next.href}>{next.cta}</Link>
        </div>
      )}
    </form>
  );
}
