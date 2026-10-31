import TrailerButton from "@/components/landing/TrailerButton";
import type { Showtime } from "@/lib/catalog";

// "Clips" row from Figma Home (17:295): tall 9:16 cards that play each premiere's trailer.
export default function ClipsRow({ films }: { films: Showtime[] }) {
  return (
    <section className="lp-section hm-row" aria-labelledby="hm-clips">
      <div className="hm-row-head">
        <div><h2 id="hm-clips">Clips</h2><p>Trailers for every premiere this week. Reactions and cast Q&amp;As arrive with the studios.</p></div>
      </div>
      <div className="hm-clips">
        {films.slice(0, 6).map((s) => {
          const c = s.poster ?? { from: "#1b1b21", via: "#0e0e12", to: "#000", glow: "rgba(227,24,45,.45)" };
          return (
            <TrailerButton key={s.id} film={s.id} title={s.film} className="hm-clip" ariaLabel={`Play the ${s.film} trailer`}>
              <span className="hm-clip-bg" style={{ background: `linear-gradient(180deg, ${c.from} 0%, ${c.via} 60%, ${c.to} 100%)` }} />
              <span className="hm-clip-glow" style={{ background: `radial-gradient(circle, ${c.glow}, transparent 70%)` }} />
              <span className="hm-clip-shade" />
              <span className="hm-clip-play" aria-hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg></span>
              <span className="hm-clip-c"><strong>{s.film} · trailer</strong><small>{s.studio}</small></span>
            </TrailerButton>
          );
        })}
      </div>
    </section>
  );
}
