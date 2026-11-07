/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";

// Product picture: an uploaded photo first, then the product photo from the Figma shop design
// (public/shop), then drawn art in the shop's colours for anything new.
const PHOTO: Record<string, string> = {
  "vr-headset": "vr-headset", "over-ear-headset": "over-ear-headset", earbuds: "earbuds", "power-bank": "power-bank",
  "popcorn-box": "popcorn-drink-box", "logo-tshirt": "logo-tshirt", "premiere-cap": "premiere-cap", "tote-bag": "tote-bag",
  umbrella: "umbrella", "table-water": "table-water", "strawberry-yoghurt": "strawberry-yoghurt", "premiere-hoodie": "premiere-hoodie",
  "steel-bottle": "steel-bottle", "popcorn-bucket": "popcorn-bucket", "gift-card": "gift-card",
};
export const productPhoto = (id: string, images?: string[]) => images?.[0] ?? (PHOTO[id] ? `/shop/${PHOTO[id]}.jpg` : "");
const LOOK: Record<string, { from: string; to: string; glyph: string }> = {
  "vr-headset": { from: "#2a1550", to: "#0c0a18", glyph: "vr" },
  "over-ear-headset": { from: "#1d2a3a", to: "#0a0d12", glyph: "headset" },
  earbuds: { from: "#24303a", to: "#0b0e11", glyph: "earbuds" },
  "power-bank": { from: "#1f2c22", to: "#0a0f0b", glyph: "battery" },
  "popcorn-box": { from: "#5a1018", to: "#1a0507", glyph: "popcorn" },
  "logo-tshirt": { from: "#26262e", to: "#0a0a0c", glyph: "tshirt" },
  "premiere-cap": { from: "#3a0d12", to: "#0e0405", glyph: "cap" },
  "tote-bag": { from: "#3b3326", to: "#100e0a", glyph: "tote" },
  umbrella: { from: "#14283a", to: "#060b10", glyph: "umbrella" },
  "table-water": { from: "#0f3340", to: "#051014", glyph: "water" },
  "strawberry-yoghurt": { from: "#5a1a33", to: "#18060d", glyph: "yoghurt" },
  "premiere-hoodie": { from: "#2b2b33", to: "#0a0a0c", glyph: "hoodie" },
  "steel-bottle": { from: "#2a2f36", to: "#0b0c0e", glyph: "bottle" },
  "popcorn-bucket": { from: "#4a2a0c", to: "#140b03", glyph: "bucket" },
  "gift-card": { from: "#3a0d12", to: "#0a0a0c", glyph: "gift" },
};

const G: Record<string, React.ReactNode> = {
  vr: <><rect x="8" y="22" width="48" height="22" rx="8" /><circle cx="22" cy="33" r="5" /><circle cx="42" cy="33" r="5" /><path d="M29 40c1.5-2 4.5-2 6 0M8 30H4M56 30h4" /></>,
  headset: <><path d="M14 38v-6a18 18 0 0 1 36 0v6" /><rect x="10" y="36" width="10" height="16" rx="4" /><rect x="44" y="36" width="10" height="16" rx="4" /></>,
  earbuds: <><path d="M20 18a7 7 0 0 1 7 7v4a7 7 0 0 1-7 7h-1v14" /><path d="M44 18a7 7 0 0 0-7 7v4a7 7 0 0 0 7 7h1v14" /></>,
  battery: <><rect x="14" y="14" width="36" height="40" rx="6" /><path d="M26 10h12M34 24l-6 10h8l-6 10" /></>,
  popcorn: <><path d="M16 26l5 30h22l5-30z" /><path d="M24 26v30M40 26v30M16 26c0-6 5-9 9-7 1-5 9-6 11-1 4-3 11 0 10 6" /></>,
  tshirt: <><path d="M24 12l-12 7 5 10 5-3v26h20V26l5 3 5-10-12-7c-1 4-4 6-8 6s-7-2-8-6z" /></>,
  cap: <><path d="M12 40c0-12 9-22 20-22s20 10 20 22z" /><path d="M8 40h48c0 4-10 6-24 6S8 44 8 40zM32 18v-3" /></>,
  tote: <><path d="M14 24h36l-3 30H17z" /><path d="M24 24v-4a8 8 0 0 1 16 0v4" /></>,
  umbrella: <><path d="M8 34a24 24 0 0 1 48 0z" /><path d="M32 34v16a4 4 0 0 1-8 0M32 10v4" /></>,
  water: <><path d="M26 10h12v6l4 6v30a4 4 0 0 1-4 4H26a4 4 0 0 1-4-4V22l4-6z" /><path d="M22 30h20M22 42h20" /></>,
  yoghurt: <><path d="M18 22h28l-4 32H22z" /><path d="M16 16h32v6H16zM26 36c2-3 4-3 6 0s4 3 6 0" /></>,
  hoodie: <><path d="M24 12c0 6 4 10 8 10s8-4 8-10l12 8-4 12-5-3v25H21V29l-5 3-4-12z" /><path d="M28 30v8M36 30v8" /></>,
  bottle: <><path d="M26 8h12v6c4 2 6 6 6 10v28a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V24c0-4 2-8 6-10z" /><path d="M20 30h24" /></>,
  bucket: <><path d="M14 22l6 34h24l6-34z" /><path d="M14 22c0-5 6-8 10-6 2-5 12-5 14 0 4-2 12 1 12 6M22 34l4 22M42 34l-4 22" /></>,
  gift: <><rect x="10" y="20" width="44" height="28" rx="4" /><path d="M10 30h44M32 20v28M32 20c-4-8-12-6-10 0M32 20c4-8 12-6 10 0" /></>,
};

export default function ProductArt({ id, name, images, className, style, size = 96 }: { id: string; name: string; images?: string[]; className?: string; style?: CSSProperties; size?: number }) {
  const photo = productPhoto(id, images);
  if (photo) return <img className={`pa ${className ?? ""}`} style={style} src={photo} alt={name} loading="lazy" />;
  const look = LOOK[id] ?? { from: "#26262e", to: "#0a0a0c", glyph: "gift" };
  return (
    <div className={`pa ${className ?? ""}`} role="img" aria-label={name} style={{ ...style, background: `radial-gradient(120% 90% at 30% 20%, ${look.from}, ${look.to})` }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {G[look.glyph]}
      </svg>
      {size >= 60 && <span className="pa-mark">E-CINEMA</span>}
    </div>
  );
}
