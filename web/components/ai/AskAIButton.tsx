"use client";

import { useEffect, useState } from "react";
import ConciergeChat from "./ConciergeChat";

// The "Ask AI" pill in every top bar. Opens the concierge in a side drawer; Ctrl/⌘ K works anywhere.
export default function AskAIButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" className="ai-pill" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="ai-spark" aria-hidden>✦</span><span className="ai-pill-label">Ask AI</span><kbd aria-hidden>⌘K</kbd>
      </button>
      {open && (
        <div className="ai-drawer-wrap" onClick={() => setOpen(false)}>
          <aside className="ai-drawer" role="dialog" aria-label="E-Cinema AI" onClick={(e) => e.stopPropagation()}>
            <header>
              <span className="ai-orb" aria-hidden>✦</span>
              <div>
                <strong>E-Cinema AI</strong>
                <span>Finds films, holds seats, builds the PayPal order. You approve every payment.</span>
              </div>
              <button type="button" className="ai-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </header>
            <ConciergeChat compact autoFocus />
          </aside>
        </div>
      )}
    </>
  );
}
