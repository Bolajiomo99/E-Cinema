import { ImageResponse } from "next/og";
import { ogFonts } from "@/lib/og-fonts";

export const alt = "E-Cinema: new films live on opening night, together";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture shown when an E-Cinema link is shared on WhatsApp, X, Facebook or LinkedIn.
export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80,
        background: "radial-gradient(circle at 75% 30%, #5a0b14 0%, #12040a 45%, #000 100%)", color: "#fff", fontFamily: "Manrope" }}>
        <div style={{ fontSize: 150, fontFamily: "Bebas Neue", letterSpacing: 6, lineHeight: 1, color: "#e3182d" }}>E-CINEMA</div>
        <div style={{ width: 300, height: 8, borderRadius: 8, background: "#e3182d", marginTop: 4, marginBottom: 40 }} />
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>Premieres, together.</div>
        <div style={{ fontSize: 32, color: "#c7c7cc", marginTop: 20 }}>New films live on opening night, in your language and currency.</div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
