import type { Showtime } from "@/lib/catalog";

// Big kids poster tile (Figma 89:1020 "Poster tile"): title in the display face at the bottom.
export default function KidsTile({ s, big }: { s: Showtime; big?: boolean }) {
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(43,179,163,.45)" };
  return (
    <span className={`kd-tile${big ? " big" : ""}`} style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }}>
      <span className="lp-poster-glow" style={{ background: p.glow }} aria-hidden />
      <span className="lp-poster-shade" aria-hidden />
      <b>{s.film}</b>
    </span>
  );
}
