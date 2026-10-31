"use client";

import { useEffect } from "react";

// Old links use /checkout#<showtime>; send them to /checkout?film=<showtime>.
export default function HashToFilm() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (/^[a-z0-9-]{3,80}$/.test(id)) window.location.replace(`/checkout?film=${encodeURIComponent(id)}`);
  }, []);
  return null;
}
