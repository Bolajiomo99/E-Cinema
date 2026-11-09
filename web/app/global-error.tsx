"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/report-error";

// Last resort when the whole layout crashes: plain HTML, no shared styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error, { digest: error.digest }), [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#000", color: "#fff", fontFamily: "system-ui, sans-serif", padding: 16 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ color: "#a1a1aa", margin: "0 0 20px" }}>E-Cinema hit a problem. Our team has been told.</p>
          <button type="button" onClick={reset} style={{ background: "#e3182d", color: "#fff", border: 0, borderRadius: 8, padding: "12px 20px", font: "600 16px system-ui", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
