import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DashShell, SidebarToggle } from "@/components/dash/DashShell";
import LibraryShelf, { type Card } from "@/components/library/LibraryShelf";
import KeepButton from "@/components/library/KeepButton";
import { accountApi, currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { findShowtime } from "@/lib/catalog";
import { keepPrice, myLibrary, type LibraryItem } from "@/lib/library";
import { countryName } from "@/lib/plans";

// Built from the Figma frames "Web / Library" (19:583), "Library · Collections" (101:1208) and
// "Library · Requested" (101:1387).
export const dynamic = "force-dynamic";
export const metadata = { title: "Library · E-Cinema" };

const DAY = 86_400_000;
const hm = (min = 120) => `${Math.floor(min / 60)}H ${String(min % 60).padStart(2, "0")}M`;

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ film?: string; tab?: string; kept?: string }> }) {
  const me = await currentAccount();
  if (!me) redirect("/signin?next=/library");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const sp = await searchParams;
  const [lib, prof] = await Promise.all([myLibrary(session), accountApi("GET", "/v1/me/profile", undefined, session).catch(() => null)]);
  const country = prof?.status === 200 ? ((prof.body as { country?: string }).country ?? "") : "";
  const now = Date.now();

  const cards: Card[] = [];
  for (const it of lib.items) {
    const s = findShowtime(it.showtimeId);
    const days = it.expiresAt ? Math.max(0, Math.ceil((Date.parse(it.expiresAt) - now) / DAY)) : 0;
    cards.push({
      key: it.showtimeId, kind: it.owned ? "owned" : "replay", showtimeId: it.showtimeId, title: it.film, year: s?.year,
      genres: s?.genres ?? [], language: s?.language ?? "", addedAt: it.addedAt,
      note: it.owned ? `Owned · ${it.quality === "4k" ? "4K" : "HD"}` : `Expires in ${days} day${days === 1 ? "" : "s"}`,
      warn: !it.owned, colors: s?.poster ? [s.poster.from, s.poster.via] : ["#1b1b21", "#0e0e12"], href: `/library?film=${it.showtimeId}`,
    });
  }
  for (const r of lib.requested) {
    cards.push({
      key: `classic-${r.id}`, kind: "requested", title: r.title, year: r.year, genres: [], language: "", addedAt: r.requestedAt,
      note: "Requested classic", colors: r.colors, href: "/classics",
    });
  }

  const hero: LibraryItem | undefined = lib.items.find((i) => i.showtimeId === sp.film) ?? lib.items[0];
  const hs = hero ? findShowtime(hero.showtimeId) : undefined;
  const heroDays = hero?.expiresAt ? Math.max(0, Math.ceil((Date.parse(hero.expiresAt) - now) / DAY)) : 0;
  const glow = hs?.poster?.glow ?? "rgba(70,150,255,.45)";

  return (
    <DashShell defaultOpen>
      <main id="main" className="lib">
        <div className="lib-bar"><SidebarToggle /></div>
        {hero && hs ? (
          <section className="lib-hero" style={{ ["--lib-glow" as string]: glow }}>
            <div className="lib-poster" style={{ background: `linear-gradient(180deg, ${hs.poster?.from ?? "#0c2a3a"} 0%, ${hs.poster?.via ?? "#06121a"} 55%, #000 100%)` }}>
              <span>{hs.film}</span>
            </div>
            <div className="lib-hero-body">
              <h1>{hs.film}</h1>
              <ul className="lib-tags">
                {hs.year && <li>{hs.year}</li>}
                <li>{hm(hs.runtimeMin)}</li>
                {hs.rating && <li>{hs.rating}</li>}
                <li>{hero.quality === "4k" ? "4K" : "HD"}</li>
                {hs.format?.includes("HDR") && <li>HDR10</li>}
                {hs.format?.includes("Atmos") && <li>Dolby Atmos</li>}
                <li className={hero.owned ? "" : "warn"}>{hero.owned ? "Owned" : `Replay · ${heroDays} day${heroDays === 1 ? "" : "s"} left`}</li>
              </ul>
              {hs.blurb && <p className="lib-blurb">{hs.blurb}</p>}
              <dl className="lib-meta">
                <div><dt>Studio</dt><dd>{hs.studio}</dd></div>
                <div><dt>Original audio</dt><dd>{hs.language ?? "English"}</dd></div>
                <div><dt>Audio tracks</dt><dd>{hs.language ?? "English"}{hs.dubs ? `, AI dubs +${hs.dubs}` : ""}</dd></div>
              </dl>
              <div className="lib-actions">
                <Link href={`/library/play/${hs.id}`} className="lib-play">Play</Link>
                <Link href={`/library/rewatch/${hs.id}`} className="lib-ghost">Rewatch with friends</Link>
                {!hero.owned && (
                  <KeepButton showtimeId={hs.id} hd={keepPrice(hs.price.value, "hd")} uhd={keepPrice(hs.price.value, "4k")} currency={hs.price.currency} kept={sp.kept === "1"} />
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="lib-hero lib-hero-empty">
            <div className="lib-hero-body">
              <h1>Your library</h1>
              <p className="lib-blurb">Films you watch at a premiere stay here for 30 days so you can watch again. Keep the ones you love for good.</p>
              <div className="lib-actions"><Link href="/releases" className="lib-play">See what is on</Link></div>
            </div>
          </section>
        )}

        <LibraryShelf
          cards={cards}
          requested={lib.requested}
          collections={lib.collections}
          films={lib.items.map((i) => ({ id: i.showtimeId, title: i.film, colors: findShowtime(i.showtimeId)?.poster ? [findShowtime(i.showtimeId)!.poster!.from, findShowtime(i.showtimeId)!.poster!.via] : ["#1b1b21", "#0e0e12"] }))}
          tab={sp.tab}
          country={country ? countryName(country) : ""}
        />
      </main>
    </DashShell>
  );
}
