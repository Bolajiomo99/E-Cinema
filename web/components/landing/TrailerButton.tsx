"use client";

import { useEffect, useRef, useState } from "react";

type T = { url: string; studio: boolean; endSec?: number; credit?: string };

// "Watch trailer" from the Figma landing hero (14:280). Opens a player over the page.
export default function TrailerButton({ film, title, className, label = "Watch trailer", children, ariaLabel }: { film: string; title: string; className?: string; label?: string; children?: React.ReactNode; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<T | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    if (t) return;
    fetch(`/api/trailer/${film}`).then(async (r) => {
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Trailer unavailable");
      setT(await r.json());
    }).catch((e: Error) => setError(e.message));
  }, [open, film, t]);

  const close = () => {
    video.current?.pause();
    dialog.current?.close();
    setOpen(false);
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={ariaLabel}>{children ?? label}</button>
      {open && (
        <dialog ref={dialog} className="tr-dialog" onClose={close} onClick={(e) => e.target === dialog.current && close()} aria-label={`${title} trailer`}>
          <div className="tr-box">
            <header>
              <strong>{title}</strong>
              <button type="button" onClick={close} aria-label="Close the trailer">✕</button>
            </header>
            {error ? <p className="tr-msg">{error}. Please try again later.</p>
              : !t ? <p className="tr-msg">Loading the trailer…</p>
              : (
                <>
                  <video
                    ref={video}
                    src={t.endSec ? `${t.url}#t=0,${t.endSec}` : t.url}
                    controls
                    autoPlay
                    playsInline
                    controlsList="nodownload"
                    onTimeUpdate={(e) => { if (t.endSec && e.currentTarget.currentTime >= t.endSec) e.currentTarget.pause(); }}
                  />
                  {!t.studio && <p className="tr-note">The studio has not uploaded this trailer yet, so this is a preview from our stand-in film: {t.credit}</p>}
                </>
              )}
          </div>
        </dialog>
      )}
    </>
  );
}
