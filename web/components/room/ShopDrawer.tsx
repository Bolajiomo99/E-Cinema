"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ShopTab } from "@/lib/catalog";

// Built from the Figma frame "Web / Player · Shop the film" (283:1332). Products come from
// Channel3; "Buy" opens the shop's own page, so payment happens with the shop.
type Item = { id: string; title: string; brand?: string; image?: string; price: number; currency: string; url: string; store: string; local?: { price: number; currency: string } };
const TABS: [ShopTab, string][] = [["scene", "In this scene"], ["outfits", "Outfits"], ["gifts", "Gifts"], ["snacks", "Snacks"]];
const fmt = (v: number, c: string) => {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: c === "NGN" ? 0 : 2 }).format(v); } catch { return `${c} ${v.toFixed(2)}`; }
};

export default function ShopDrawer({ showtimeId, film, friend, onClose }: { showtimeId: string; film: string; friend?: string; onClose: () => void }) {
  const [tab, setTab] = useState<ShopTab>("scene");
  const [data, setData] = useState<Record<string, Item[] | "error">>({});
  const box = useRef<HTMLDivElement>(null);
  const items = data[tab];

  useEffect(() => {
    if (data[tab]) return;
    let live = true;
    fetch(`/api/shop?showtime=${encodeURIComponent(showtimeId)}&tab=${tab}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { items: Item[] }) => live && setData((d) => ({ ...d, [tab]: j.items })))
      .catch(() => live && setData((d) => ({ ...d, [tab]: "error" })));
    return () => { live = false; };
  }, [tab, showtimeId, data]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); prev?.focus(); };
  }, [onClose]);

  const top = Array.isArray(items) ? items[0] : undefined;
  const ask = top ? `Help me send "${top.title}" as a gift${friend ? ` to ${friend}` : ""}. It is from ${top.store}.` : `Gift ideas inspired by ${film}`;
  return (
    <div className="sd-dim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sd" role="dialog" aria-modal="true" aria-labelledby="sd-h" tabIndex={-1} ref={box}>
        <div className="sd-head">
          <h2 id="sd-h">Shop the film</h2>
          <button type="button" className="sd-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="sd-sub">Things like what you see in {film}, from real shops. Prices in your currency.</p>
        <div className="sd-tabs" role="tablist" aria-label="What to shop">
          {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        <div className="sd-list" aria-live="polite">
          {!items && [0, 1, 2, 3].map((i) => <div key={i} className="sd-item skel" aria-hidden><span className="sd-img" /><span className="sd-lines"><i /><i /><i /></span></div>)}
          {items === "error" && <p className="sd-note">The shop is not answering right now. Try again in a moment.</p>}
          {Array.isArray(items) && items.length === 0 && <p className="sd-note">Nothing matched this time. Try another tab.</p>}
          {Array.isArray(items) && items.map((i) => (
            <div key={i.id} className="sd-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.image ? <img className="sd-img" src={i.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sd-img" aria-hidden />}
              <div className="sd-lines">
                <strong>{i.title}</strong>
                <small>{[i.brand, i.store].filter(Boolean).join(" · ")} · In stock</small>
                <div className="sd-buy">
                  <b title={i.local ? `The shop charges ${fmt(i.price, i.currency)}` : undefined}>{i.local ? `≈ ${fmt(i.local.price, i.local.currency)}` : fmt(i.price, i.currency)}</b>
                  {i.local && <em>{fmt(i.price, i.currency)}</em>}
                  <a href={i.url} target="_blank" rel="noopener noreferrer sponsored" aria-label={`Buy ${i.title} at ${i.store}`}>Buy</a>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="sd-tip">
          <b>Concierge</b>
          <p>{top ? `Like the ${top.title.split(/[,(|–-]/)[0].trim().slice(0, 48)}? I can help you send it as a gift and pay with your saved PayPal. I always ask first.` : `I can find gifts inspired by ${film} and pay with your saved PayPal. I always ask first.`}</p>
          <Link href={`/concierge?ask=${encodeURIComponent(ask)}`} target="_blank">Ask the concierge</Link>
        </div>
        <p className="sd-fine">Product results from Channel3. E-Cinema merch is in the Shop tab.</p>
      </div>
    </div>
  );
}
