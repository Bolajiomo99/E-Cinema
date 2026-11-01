"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LibraryPlayer from "@/components/library/LibraryPlayer";
import OfflineShell from "@/components/downloads/OfflineShell";
import { deviceId, localFile, openLocal, removeLocal, setExpiry, type LocalFile } from "@/lib/offline";

// Plays a download from this device. Online, the licence is checked (and renewed) first;
// offline, the stored expiry decides.
export default function OfflinePlayer({ id: given }: { id: string }) {
  // Offline, one cached copy of this page serves every film, so the address decides which.
  const [id, setId] = useState(given);
  const [file, setFile] = useState<LocalFile | null>(null);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    let made = "";
    const id = window.location.pathname.match(/^\/downloads\/play\/([a-z0-9-]{1,80})/)?.[1] ?? given;
    setId(id);
    (async () => {
      const f = await localFile(id).catch(() => undefined);
      if (!f) return setErr("This film is not downloaded on this device.");
      setFile(f);
      if (navigator.onLine) {
        const r = await fetch(`/api/downloads/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: deviceId(), quality: f.quality, sizeBytes: f.size, audio: f.audio }) }).catch(() => null);
        if (r?.ok) await setExpiry(id, ((await r.json()) as { expiresAt: string }).expiresAt);
        else if (r && (r.status === 402 || r.status === 410 || r.status === 401)) {
          if (r.status !== 401) await removeLocal(id);
          return setErr(r.status === 401 ? "Sign in to play your downloads." : "This download is no longer licensed on your account, so it was removed.");
        }
      }
      try {
        made = await openLocal(id);
        setUrl(made);
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [given]);

  if (err) {
    return (
      <div className="lp-empty">
        <h1>{file?.film ?? "Download"}</h1>
        <p className="muted">{err}</p>
        <Link href="/downloads" className="cta big">Back to downloads</Link>
      </div>
    );
  }
  if (!url || !file) return <div className="lp-empty"><p className="muted">Opening your download…</p></div>;
  return (
    <>
    <OfflineShell />
    <LibraryPlayer
      film={file.film} stream={{ hd: url, sd: url, title: "", credit: "", license: "", durationSec: 0 }} credit={file.credit}
      viewerCode={deviceId().slice(0, 8).toUpperCase()} original={file.audio[0] ?? "Original"} dubFilm={id} dubLanguages={[]}
      prefAudio="" prefSubs="" back="/downloads" offline showtimeId={id}
    />
    </>
  );
}
