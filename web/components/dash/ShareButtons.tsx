"use client";

import { useState } from "react";

// Invite friends and Share use the phone's share sheet where there is one, otherwise copy the link.
export default function ShareButtons({ url, film, when }: { url: string; film: string; when: string }) {
  const [note, setNote] = useState("");
  const share = async (text: string) => {
    try {
      if (navigator.share) await navigator.share({ title: `${film} on E-Cinema`, text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setNote("Link copied"); setTimeout(() => setNote(""), 2500); }
    } catch {}
  };
  return (
    <>
      <button type="button" className="ok-btn" onClick={() => share(`I've got a seat for the world premiere of ${film} (${when}). Grab one and watch with me:`)}>Invite friends</button>
      <button type="button" className="ok-btn ghost" onClick={() => share(`${film} premieres once, worldwide, on E-Cinema.`)}>{note || "Share"}</button>
    </>
  );
}
