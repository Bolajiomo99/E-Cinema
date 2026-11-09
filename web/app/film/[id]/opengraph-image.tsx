import { ImageResponse } from "next/og";
import { ogFonts } from "@/lib/og-fonts";
import { findShowtime } from "@/lib/catalog";

export const alt = "Film premiere on E-Cinema";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A film's share picture: its title and poster colours, so a link in a group chat looks like a ticket.
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const s = findShowtime((await params).id);
  const p = s?.poster ?? { from: "#40161f", via: "#1a0a10", to: "#000", glow: "#e3182d" };
  const when = s ? new Date(s.startsAt).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC" : "";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72,
        background: `linear-gradient(135deg, ${p.from} 0%, ${p.via} 55%, ${p.to} 100%)`, color: "#fff", fontFamily: "Manrope" }}>
        <div style={{ display: "flex", fontSize: 56, fontFamily: "Bebas Neue", letterSpacing: 4, color: "#e3182d" }}>E-CINEMA</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 28, color: "#e5e5ea", letterSpacing: 3 }}>{s?.adult ? "18+ · VERIFIED ADULTS" : "WORLD PREMIERE"}</div>
          <div style={{ display: "flex", fontSize: s && s.film.length > 18 ? 120 : 160, fontFamily: "Bebas Neue", lineHeight: 1, marginTop: 12, textTransform: "uppercase" }}>{s?.film ?? "E-Cinema"}</div>
          <div style={{ display: "flex", fontSize: 32, color: "#d1d1d6", marginTop: 24 }}>{s ? `${when} · ${s.studio}` : "Premieres, together."}</div>
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
