"use client";

import { useSyncExternalStore } from "react";

// The payment method picked in the list (left column) drives the pay button (right column).
let current = "";
const subs = new Set<() => void>();
export function setMethod(id: string) {
  current = id;
  subs.forEach((f) => f());
}
export function useMethod(fallback: string) {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => current || fallback,
    () => fallback,
  );
}
