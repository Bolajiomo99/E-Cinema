"use client";

import Link from "next/link";
import { useState } from "react";

// The same line of dialogue in each language chip, so the demo shows what a viewer would see.
const LINES: [string, string, string][] = [
  ["Yorùbá", "YORÙBÁ", "“Ọ̀rẹ́ mi, a ò ní fi ọ́ sílẹ̀ níbí.”"],
  ["Hausa", "HAUSA", "“Abokina, ba za mu bar ka a nan ba.”"],
  ["Igbo", "IGBO", "“Enyi m, anyị agaghị ahapụ gị ebe a.”"],
  ["English", "ENGLISH", "“My friend, we won't leave you here.”"],
  ["हिन्दी", "HINDI", "“मेरे दोस्त, हम तुम्हें यहाँ नहीं छोड़ेंगे।”"],
  ["தமிழ்", "TAMIL", "“என் நண்பா, உன்னை இங்கே விட்டுவிட மாட்டோம்.”"],
  ["Français", "FRANÇAIS", "“Mon ami, on ne te laissera pas ici.”"],
  ["Kiswahili", "KISWAHILI", "“Rafiki yangu, hatutakuacha hapa.”"],
  ["العربية", "ARABIC", "“يا صديقي، لن نتركك هنا.”"],
  ["Português", "PORTUGUÊS", "“Meu amigo, não vamos te deixar aqui.”"],
  ["Español", "ESPAÑOL", "“Amigo mío, no te vamos a dejar aquí.”"],
  ["中文", "中文", "“我的朋友，我们不会把你丢在这里。”"],
];

export default function LanguageDemo() {
  const [pick, setPick] = useState(0);
  const [, label, line] = LINES[pick];
  return (
    <div className="lp-lang">
      <div className="lp-lang-copy">
        <p className="lp-eyebrow">YOUR LANGUAGE, LIVE</p>
        <h2 className="lp-display-l"><span>HEAR EVERY FILM</span><span>IN YOUR MOTHER TONGUE</span></h2>
        <p className="lp-body-l">
          AI dubbing and subtitles run alongside the stream, so a premiere from Hollywood plays in Igbo in Enugu and in
          Tamil in Chennai. Chat messages are translated as they arrive.
        </p>
        <div className="lp-chips wrap" role="group" aria-label="Pick a language">
          {LINES.map(([name], i) => (
            <button key={name} type="button" className={`lp-chip${i === pick ? " on" : ""}`} aria-pressed={i === pick} onClick={() => setPick(i)}>{name}</button>
          ))}
          <Link href="/watch/red-earth-sample" className="lp-chip">+30 more</Link>
        </div>
      </div>
      <div className="lp-subdemo" aria-live="polite">
        <span className="lp-subdemo-glow" aria-hidden />
        <div className="lp-caption">
          <p dir="auto">{line}</p>
          <div className="lp-tracks">
            <span className="lp-badge outline">AUDIO · {label} (AI)</span>
            <span className="lp-badge outline">SUBTITLES · ENGLISH</span>
          </div>
        </div>
      </div>
    </div>
  );
}
