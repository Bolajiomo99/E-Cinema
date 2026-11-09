"use client";

import { useEffect } from "react";

// Shows every page in the visitor's language. After React has drawn the page, this swaps the
// English text of each text node (and placeholder, aria-label, title and alt) for its translation
// from the translation memory (/api/i18n), and keeps doing so as the page changes. Only the text
// of a node is changed, never the nodes themselves, so React keeps working on the same DOM.
// Anything inside translate="no" (names, chat, posts, codes) is left alone.

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "KBD", "SAMP", "TEMPLATE"]);
const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;
const worth = (s: string) =>
  /\p{L}{2}/u.test(s) && s.length <= 2000 &&
  !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(s) && !/^(https?:\/\/|www\.)\S+$/.test(s) && !/^[A-Z0-9]{2,}(-[A-Z0-9]+)+$/.test(s);

type TextState = { src: string; out: string };

export default function AutoTranslate({ lang, keep = [] }: { lang: string; keep?: string[] }) {
  const keepKey = keep.join("\n");
  useEffect(() => {
    const root = document.documentElement;
    if (lang === "en") { root.classList.remove("tr-wait"); return; }
    const key = `ec_tr:${lang}`;
    let cache: Record<string, string> = {};
    try { cache = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>; } catch { cache = {}; }
    const texts = new WeakMap<Text, TextState>();
    const attrs = new WeakMap<Element, Record<string, TextState>>();
    const pending = new Set<string>();
    const asked = new Set<string>();
    let titleOut = "";
    let timer = 0;
    let firstDone = false;
    let saveTimer = 0;

    const reveal = () => { if (!firstDone) { firstDone = true; root.classList.remove("tr-wait"); } };
    const skip = (el: Element | null): boolean => {
      for (let e = el; e; e = e.parentElement) {
        if (SKIP_TAGS.has(e.tagName) || e.getAttribute("translate") === "no" || e.classList.contains("notranslate") || (e as HTMLElement).isContentEditable) return true;
      }
      return false;
    };
    const names = new Set(["e-cinema", ...keepKey.split("\n").filter(Boolean).map((k) => k.toLowerCase())]);
    const look = (src: string): string | undefined => {
      const t = src.trim();
      if (!worth(t) || names.has(t.toLowerCase())) return undefined;
      const hit = cache[t];
      if (hit === undefined && !asked.has(t)) pending.add(t);
      return hit === undefined ? undefined : src.replace(t, hit);
    };

    function doText(n: Text) {
      const v = n.nodeValue ?? "";
      const st = texts.get(n);
      // Already translated, or still English with no translation known yet.
      if (st && v === st.out && (st.out !== st.src || cache[st.src.trim()] === undefined)) return;
      if (!v.trim() || skip(n.parentElement)) return;
      const src = st && v === st.out ? st.src : v; // new text from React, or never seen
      const out = look(src);
      texts.set(n, { src, out: out ?? src });
      if (out !== undefined && out !== v) n.nodeValue = out;
    }
    function doAttr(el: Element, a: string) {
      const v = el.getAttribute(a) ?? "";
      const rec = attrs.get(el) ?? {};
      const st = rec[a];
      if (st && v === st.out && (st.out !== st.src || cache[st.src.trim()] === undefined)) return;
      if (!v.trim() || skip(el)) return;
      const src = st && v === st.out ? st.src : v;
      const out = look(src);
      rec[a] = { src, out: out ?? src };
      attrs.set(el, rec);
      if (out !== undefined && out !== v) el.setAttribute(a, out);
    }
    function walk(node: Node) {
      if (node.nodeType === Node.TEXT_NODE) { doText(node as Text); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) doText(n);
      for (const a of ATTRS) {
        if (el.hasAttribute(a)) doAttr(el, a);
        for (const c of el.querySelectorAll(`[${a}]`)) doAttr(c, a);
      }
    }
    function doTitle() {
      const t = document.title;
      if (!t || t === titleOut) return;
      const out = look(t);
      if (out && out !== t) { titleOut = out; document.title = out; }
    }
    function after() {
      if (pending.size) fetchMissing();
      else reveal();
    }
    function scan() {
      timer = 0;
      walk(document.body);
      doTitle();
      after();
    }

    let inflight = false;
    async function fetchMissing() {
      if (inflight) return;
      inflight = true;
      try {
        while (pending.size) {
          const batch = [...pending].slice(0, 300);
          for (const s of batch) { pending.delete(s); asked.add(s); }
          const r = await fetch("/api/i18n", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang, strings: batch }) });
          if (!r.ok) break;
          const { map } = (await r.json()) as { map: Record<string, string> };
          for (const [s, t] of Object.entries(map ?? {})) if (t && t !== s) cache[s] = t;
          for (const s of batch) asked.delete(s); // translated ones are now in the cache; the rest stay English
          for (const s of batch) if (!cache[s]) asked.add(s);
          clearTimeout(saveTimer);
          saveTimer = window.setTimeout(save, 500);
          schedule(0);
        }
      } catch {
        // offline or the server is busy: the page stays in English
      } finally {
        inflight = false;
        reveal();
      }
    }
    function save() {
      try {
        let s = JSON.stringify(cache);
        if (s.length > 3_000_000) { cache = {}; s = "{}"; }
        localStorage.setItem(key, s);
      } catch { /* storage full or blocked */ }
    }
    function schedule(ms = 40) {
      if (!timer) timer = window.setTimeout(scan, ms);
    }

    // Runs before the browser paints, so text React just rendered never shows in English when
    // its translation is already known.
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "characterData") doText(r.target as Text);
        else if (r.type === "attributes") doAttr(r.target as Element, r.attributeName!);
        else r.addedNodes.forEach(walk);
      }
      after();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    const titleEl = document.querySelector("title");
    const mt = titleEl ? new MutationObserver(() => { doTitle(); after(); }) : null;
    if (titleEl) mt!.observe(titleEl, { childList: true, characterData: true, subtree: true });
    scan();
    const failSafe = window.setTimeout(reveal, 2500);
    return () => { mo.disconnect(); mt?.disconnect(); clearTimeout(timer); clearTimeout(failSafe); clearTimeout(saveTimer); };
  }, [lang, keepKey]);
  return null;
}
