"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

// The shelf under the Library hero (Figma 19:583, 101:1208, 101:1387): tab chips, the
// Genre / Year / Language / Sort menus, the poster grid, requested classics and collections.
export type Card = {
  key: string; kind: "owned" | "replay" | "requested"; showtimeId?: string; title: string; year?: number;
  genres: string[]; language: string; addedAt: string; note: string; warn?: boolean; colors: string[]; href: string;
};
type Requested = { id: string; title: string; year?: number; votes: number; status: "yes" | "talks" | "blocked" | "sent"; startsAt?: string };
type Collection = { id: string; name: string; kids: boolean; colors: string[]; films: string[]; sharedWith: string[]; mine: boolean; owner?: string };
type Film = { id: string; title: string; colors: string[] };

const TABS = ["all", "owned", "downloads", "requested", "collections"] as const;
type Tab = (typeof TABS)[number];
const SORTS = { recent: "Recently added", title: "Title A to Z", year: "Newest year" } as const;

function Menu({ label, value, options, onPick }: { label: string; value: string; options: string[]; onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="lib-menu" ref={ref}>
      <button type="button" className={value ? "on" : ""} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value ? `${label}: ${value}` : label}
      </button>
      {open && (
        <ul role="listbox">
          <li><button type="button" onClick={() => { onPick(""); setOpen(false); }}>Any</button></li>
          {options.map((o) => (
            <li key={o}><button type="button" aria-selected={o === value} className={o === value ? "on" : ""} onClick={() => { onPick(o); setOpen(false); }}>{o}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const poster = (c: string[]) => ({ background: `linear-gradient(180deg, ${c[0] ?? "#1b1b21"} 0%, ${c[1] ?? "#0e0e12"} 55%, #000 100%)` });

export default function LibraryShelf({ cards, requested, collections: initial, films, tab: tab0, country }: {
  cards: Card[]; requested: Requested[]; collections: Collection[]; films: Film[]; tab?: string; country: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(TABS.includes(tab0 as Tab) ? (tab0 as Tab) : "all");
  const [genre, setGenre] = useState("");
  const [year, setYear] = useState("");
  const [lang, setLang] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("recent");
  const [cols, setCols] = useState(initial);
  const [openCol, setOpenCol] = useState<string | null>(null);

  const pick = (t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    if (t === "all") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u);
  };

  const genres = useMemo(() => [...new Set(cards.flatMap((c) => c.genres))].sort(), [cards]);
  const years = useMemo(() => [...new Set(cards.map((c) => c.year).filter(Boolean))].sort((a, b) => b! - a!).map(String), [cards]);
  const langs = useMemo(() => [...new Set(cards.map((c) => c.language).filter(Boolean))].sort(), [cards]);

  const shown = useMemo(() => {
    let list = cards.filter((c) => (tab === "owned" ? c.kind === "owned" : tab === "all" ? true : false));
    if (genre) list = list.filter((c) => c.genres.includes(genre));
    if (year) list = list.filter((c) => String(c.year) === year);
    if (lang) list = list.filter((c) => c.language === lang);
    const by = { recent: (a: Card, b: Card) => b.addedAt.localeCompare(a.addedAt), title: (a: Card, b: Card) => a.title.localeCompare(b.title), year: (a: Card, b: Card) => (b.year ?? 0) - (a.year ?? 0) };
    return [...list].sort(by[sort]);
  }, [cards, tab, genre, year, lang, sort]);

  const counts = { all: cards.length, owned: cards.filter((c) => c.kind === "owned").length, requested: requested.length };

  return (
    <section className="lib-shelf">
      <div className="lib-filters">
        <div className="lib-tabs" role="tablist" aria-label="Library">
          <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => pick("all")}>All {counts.all}</button>
          <button type="button" role="tab" aria-selected={tab === "owned"} className={tab === "owned" ? "on" : ""} onClick={() => pick("owned")}>Owned{counts.owned ? ` ${counts.owned}` : ""}</button>
          <Link href="/downloads" role="tab" aria-selected={false}>Downloads</Link>
          <button type="button" role="tab" aria-selected={tab === "requested"} className={tab === "requested" ? "on" : ""} onClick={() => pick("requested")}>Requested</button>
          <button type="button" role="tab" aria-selected={tab === "collections"} className={tab === "collections" ? "on" : ""} onClick={() => pick("collections")}>Collections</button>
        </div>
        {(tab === "all" || tab === "owned") && (
          <div className="lib-sorts">
            <Menu label="Genre" value={genre} options={genres} onPick={setGenre} />
            <Menu label="Year" value={year} options={years} onPick={setYear} />
            <Menu label="Language" value={lang} options={langs} onPick={setLang} />
            <Menu label="Sort" value={SORTS[sort]} options={Object.values(SORTS)} onPick={(v) => setSort((Object.entries(SORTS).find(([, l]) => l === v)?.[0] as keyof typeof SORTS) ?? "recent")} />
          </div>
        )}
      </div>

      {(tab === "all" || tab === "owned") && (
        shown.length ? (
          <ul className="lib-grid">
            {shown.map((c) => (
              <li key={c.key}>
                <Link href={c.href} scroll={c.kind !== "requested"} className="lib-card">
                  <div className="lib-card-art" style={poster(c.colors)}><span>{c.title}</span></div>
                  <strong>{c.title}{c.year ? ` · ${c.year}` : ""}</strong>
                  <em className={c.warn ? "warn" : ""}>{c.note}</em>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="lib-empty">
            <h2>{tab === "owned" ? "Nothing kept yet" : genre || year || lang ? "Nothing matches those filters" : "Your library is empty"}</h2>
            <p>{tab === "owned" ? "Keep a film after its premiere and it stays here for good, ready to download." : "Every premiere you watch lands here for 30 days."}</p>
          </div>
        )
      )}

      {tab === "requested" && <RequestedList list={requested} country={country} />}

      {tab === "collections" && (
        openCol && cols.find((c) => c.id === openCol) ? (
          <CollectionView
            col={cols.find((c) => c.id === openCol)!} films={films}
            onChange={(c) => setCols((xs) => xs.map((x) => (x.id === c.id ? c : x)))}
            onGone={(id) => { setCols((xs) => xs.filter((x) => x.id !== id)); setOpenCol(null); }}
            onBack={() => setOpenCol(null)}
          />
        ) : (
          <Collections cols={cols} onOpen={setOpenCol} onAdd={(c) => { setCols((xs) => [...xs, c]); router.refresh(); }} />
        )
      )}
    </section>
  );
}

const STATUS: Record<Requested["status"], { label: (r: Requested, country: string) => string; cls: string }> = {
  yes: { label: (r) => `Studio said yes${r.startsAt ? ` · ${new Date(r.startsAt).toLocaleDateString([], { month: "short", year: "numeric" })}` : ""}`, cls: "yes" },
  talks: { label: () => "Talking to rights holder", cls: "talks" },
  blocked: { label: (_r, c) => `Not available in ${c || "your country"} yet`, cls: "blocked" },
  sent: { label: () => "Request sent to studio", cls: "sent" },
};

function RequestedList({ list, country }: { list: Requested[]; country: string }) {
  if (!list.length) {
    return (
      <div className="lib-empty">
        <h2>No requests yet</h2>
        <p>Ask for an older film you want back on the big screen. When enough people ask, the studio schedules a one-night screening.</p>
        <Link href="/classics" className="lib-play">Request a classic</Link>
      </div>
    );
  }
  return (
    <ul className="lib-req">
      {list.map((r) => (
        <li key={r.id}>
          <Link href="/classics">{r.title}{r.year ? ` (${r.year})` : ""}</Link>
          <span className="lib-votes">{r.votes.toLocaleString()} vote{r.votes === 1 ? "" : "s"}</span>
          <span className={`lib-status ${STATUS[r.status].cls}`}>{STATUS[r.status].label(r, country)}</span>
        </li>
      ))}
    </ul>
  );
}

function sub(c: Collection) {
  const n = `${c.films.length} film${c.films.length === 1 ? "" : "s"}`;
  if (!c.mine) return `${n} · from ${c.owner}`;
  if (c.sharedWith.length) return `${n} · shared with ${c.sharedWith.length} friend${c.sharedWith.length === 1 ? "" : "s"}`;
  return c.kids ? `${n} · kids profile` : n;
}

async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(`/api/collections${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((out as { error?: string }).error ?? "Something went wrong");
  return out;
}

function Collections({ cols, onOpen, onAdd }: { cols: Collection[]; onOpen: (id: string) => void; onAdd: (c: Collection) => void }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [kids, setKids] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const c = (await call("POST", "", { name, kids })) as Collection;
      onAdd(c);
      setMaking(false);
      setName("");
      setKids(false);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ul className="lib-cols">
      {cols.map((c) => (
        <li key={c.id}>
          <button type="button" className="lib-col" onClick={() => onOpen(c.id)}>
            <div className="lib-col-art" style={{ background: `linear-gradient(90deg, ${c.colors[0]} 0%, ${c.colors[1]} 60%, #0a0a0c 100%)` }}><span>{c.name}</span></div>
            <em>{sub(c)}</em>
          </button>
        </li>
      ))}
      <li>
        {making ? (
          <form className="lib-col-new on" onSubmit={create}>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus placeholder="Nollywood nights" /></label>
            <label className="lib-check"><input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} /> For the kids profile</label>
            {err && <p className="lib-err" role="alert">{err}</p>}
            <div>
              <button type="submit" className="lib-play" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create"}</button>
              <button type="button" className="lib-ghost" onClick={() => setMaking(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="lib-col" onClick={() => setMaking(true)}>
            <div className="lib-col-art lib-col-plus"><span>+ New collection</span></div>
            <em>Tap to create</em>
          </button>
        )}
      </li>
    </ul>
  );
}

function CollectionView({ col, films, onChange, onGone, onBack }: { col: Collection; films: Film[]; onChange: (c: Collection) => void; onGone: (id: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [name, setName] = useState(col.name);
  const run = async (fn: () => Promise<void>) => {
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  const toggle = (id: string) => run(async () => {
    const inIt = col.films.includes(id);
    await call(inIt ? "DELETE" : "PUT", `/${col.id}/films/${id}`);
    onChange({ ...col, films: inIt ? col.films.filter((f) => f !== id) : [id, ...col.films] });
  });
  const known = new Map(films.map((f) => [f.id, f]));
  return (
    <div className="lib-colview">
      <div className="lib-colview-head">
        <button type="button" className="lib-ghost" onClick={onBack}>‹ All collections</button>
        {col.mine ? (
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { await call("PUT", `/${col.id}`, { name, kids: col.kids }); onChange({ ...col, name: name.trim() }); setMsg("Saved"); }); }}>
            <input aria-label="Collection name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <label className="lib-check"><input type="checkbox" checked={col.kids} onChange={(e) => run(async () => { await call("PUT", `/${col.id}`, { name: col.name, kids: e.target.checked }); onChange({ ...col, kids: e.target.checked }); })} /> Kids profile</label>
            <button type="submit" className="lib-ghost" disabled={!name.trim() || name.trim() === col.name}>Rename</button>
          </form>
        ) : (
          <h2>{col.name} <small>from {col.owner}</small></h2>
        )}
        <button type="button" className="lib-ghost danger" onClick={() => run(async () => { await call("DELETE", `/${col.id}`); onGone(col.id); })}>
          {col.mine ? "Delete collection" : "Remove from my library"}
        </button>
      </div>

      {col.films.length ? (
        <ul className="lib-grid">
          {col.films.map((id) => {
            const f = known.get(id);
            return (
              <li key={id}>
                <div className="lib-card">
                  <Link href={f ? `/library?film=${id}` : `/film/${id}`} className="lib-card-art" style={poster(f?.colors ?? [])}><span>{f?.title ?? id.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-/g, " ")}</span></Link>
                  {col.mine && <button type="button" className="lib-card-x" onClick={() => toggle(id)}>Remove</button>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="lib-empty"><h2>No films here yet</h2><p>{col.mine ? "Add films from your library below." : "The owner has not added films yet."}</p></div>
      )}

      {col.mine && (
        <div className="lib-colview-tools">
          <div>
            <h3>Add from your library</h3>
            {films.length ? (
              <div className="lib-pick">
                {films.map((f) => (
                  <button key={f.id} type="button" className={col.films.includes(f.id) ? "on" : ""} aria-pressed={col.films.includes(f.id)} onClick={() => toggle(f.id)}>{f.title}</button>
                ))}
              </div>
            ) : <p className="lib-muted">Films you watch show up here to add.</p>}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); run(async () => { const r = (await call("POST", `/${col.id}/shares`, { email })) as { name: string }; onChange({ ...col, sharedWith: col.sharedWith.includes(r.name) ? col.sharedWith : [...col.sharedWith, r.name] }); setEmail(""); setMsg(`Shared with ${r.name}`); }); }}>
            <h3>Share with a friend</h3>
            <p className="lib-muted">{col.sharedWith.length ? `Shared with ${col.sharedWith.join(", ")}.` : "Friends see it in their library, read only."}</p>
            <div className="lib-share">
              <input type="email" required placeholder="Their E-Cinema email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Friend's email" />
              <button type="submit" className="lib-play">Share</button>
            </div>
          </form>
        </div>
      )}
      {(err || msg) && <p className={err ? "lib-err" : "lib-ok"} role="status">{err || msg}</p>}
    </div>
  );
}
