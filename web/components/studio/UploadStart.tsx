"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Upload } from "@/lib/studio-types";
import { scall } from "./scall";

export default function UploadStart() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function start() {
    setBusy(true); setErr("");
    try {
      const r = await scall<{ upload: Upload }>("POST", "uploads", { title: title.trim() });
      router.push(`/studio/upload/${r.upload.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  return (
    <form className="pt-form" onSubmit={(e) => { e.preventDefault(); void start(); }}>
      <label className="vf-field"><span>Film title</span><div className="vf-box"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Red Earth" /></div></label>
      <div className="pt-btns"><button className="vf-btn red" disabled={busy || !title.trim()}>{busy ? "Starting" : "Start upload"}</button></div>
      {err && <p className="vf-err" role="alert">{err}</p>}
    </form>
  );
}
