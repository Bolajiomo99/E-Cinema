"use client";

import { useEffect } from "react";

// Registers the small service worker that keeps the Downloads pages usable offline.
export default function OfflineShell() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
