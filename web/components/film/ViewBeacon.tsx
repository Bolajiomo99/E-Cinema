"use client";

import { useEffect } from "react";

// Tells the server this film page was opened, for the studio ticket funnel. Sent once per page
// load from the browser, so link prefetches and crawlers that do not run scripts are not counted.
export default function ViewBeacon({ film }: { film: string }) {
  useEffect(() => {
    fetch("/api/insights/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ film }), keepalive: true }).catch(() => {});
  }, [film]);
  return null;
}
