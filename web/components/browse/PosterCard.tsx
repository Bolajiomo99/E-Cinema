import Link from "next/link";
import WhenBadge from "@/components/browse/WhenBadge";
import { endsAt, type Showtime } from "@/lib/catalog";
import { langCode } from "@/lib/browse";

const money = (cur: string, v: string) => (cur === "USD" ? `$${v}` : `${cur} ${v}`);

// Browse card (Figma 30:457): poster tile with the screening badge, price and language below.
export default function PosterCard({ s }: { s: Showtime }) {
  const p = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
  const words = s.film.toUpperCase().split(" ");
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words.length === 2 ? words : [s.film.toUpperCase()];
  return (
    <Link href={`/film/${s.id}`} className="br-card">
      <span className="br-poster" style={{ background: `linear-gradient(180deg, ${p.from} 0%, ${p.via} 60%, ${p.to} 100%)` }}>
        <span className="lp-poster-glow" style={{ background: p.glow }} aria-hidden />
        <span className="lp-poster-shade" aria-hidden />
        <span className="lp-poster-title">{lines.map((l) => <span key={l}>{l}</span>)}</span>
        <WhenBadge startsAt={s.startsAt} endsAt={endsAt(s)} />
        {s.adult && <span className="br-adult">18+</span>}
      </span>
      <span className="br-meta">
        <b>{money(s.price.currency, s.price.value)}</b>
        <small>{langCode(s.language)} · {s.dubs ?? 3} dubs</small>
      </span>
      <span className="sr-only">{s.film}, {s.studio}</span>
    </Link>
  );
}
