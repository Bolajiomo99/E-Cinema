"use client";
import { useEffect, useState } from "react";

// False on the server and during hydration, true after: text that depends on the viewer's
// time zone or locale renders in UTC first so the server and browser HTML match.
export function useMounted() {
  const [m, set] = useState(false);
  useEffect(() => set(true), []);
  return m;
}
