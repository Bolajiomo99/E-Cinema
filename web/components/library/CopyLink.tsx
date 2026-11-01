"use client";

import { useState } from "react";

// Share a rewatch party link: the phone's share sheet where there is one, otherwise copy it.
export default function CopyLink({ text }: { text: string }) {
  const [note, setNote] = useState("");
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "E-Cinema rewatch party", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setNote("Link copied");
        setTimeout(() => setNote(""), 2500);
      }
    } catch {}
  };
  return <button type="button" className="lib-ghost" onClick={share}>{note || "Invite friends"}</button>;
}
