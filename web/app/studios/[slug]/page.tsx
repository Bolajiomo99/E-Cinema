import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import TopNav from "@/components/dash/TopNav";
import { DashShell } from "@/components/dash/DashShell";
import LocalWhen from "@/components/dash/LocalWhen";
import FollowStudio from "@/components/studio/FollowStudio";
import { currentAccount, SESSION_COOKIE } from "@/lib/auth";
import { nameOf } from "@/lib/countries";
import { readLocale } from "@/lib/locale";
import { studioPublicPage, type PageFilm } from "@/lib/studio-page";

// Built from the Figma frame "Web / Studio page" (597:27): a verified studio's own page, its
// coming and past premieres, and a follow button. Every number is counted, never estimated.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const p = await studioPublicPage((await params).slug);
  return { title: p ? `${p.name} · E-Cinema` : "Studio · E-Cinema", description: p ? p.bio || `Premieres from ${p.name} on E-Cinema.` : undefined };
}

const TONES = ["#2a110c", "#3b2a0a", "#0c2a3a", "#0f3324", "#1d1440", "#2a070c"];
function tone(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

function Card({ f, past }: { f: PageFilm; past?: boolean }) {
  const art = f.poster
    ? { backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(0,0,0,.85)), url(/api/films/${f.upload}/poster)` }
    : { background: `linear-gradient(180deg, ${tone(f.showtimeId)}, #000)` };
  return (
    <Link href={`/film/${f.showtimeId}`} className="sp-card">
      <span className="sp-art" style={art}><strong>{f.film}</strong></span>
      <small>
        {past
          ? `Premiered ${day(f.startsAt)}${f.reviews ? ` · ${f.rating.toFixed(1)} ★ from ${f.reviews.toLocaleString("en-GB")} ${f.reviews === 1 ? "review" : "reviews"}` : ""}`
          : <><LocalWhen iso={f.startsAt} /> · {usd(f.priceCents)}</>}
      </small>
    </Link>
  );
}

export default async function StudioPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const [p, me, loc] = await Promise.all([studioPublicPage(slug, session), currentAccount(), readLocale()]);
  if (!p) notFound();
  const initials = p.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const place = [p.city, p.country ? nameOf(p.country) : ""].filter(Boolean).join(", ");
  const since = p.verifiedAt ? new Date(p.verifiedAt).getUTCFullYear() : null;
  const body = (
    <div className="sp-page">
      <span className="sp-glow" aria-hidden />
      <TopNav me={me} t={loc.t} country={loc.country} lang={loc.lang} />
      <header className="sp-head">
        <span className="sp-av" aria-hidden>{initials}</span>
        <div className="sp-id">
          <span className="sp-kicker">Studio</span>
          <h1>{p.name}</h1>
          <p className="sp-sub">{[place, "Verified studio", since ? `on E-Cinema since ${since}` : ""].filter(Boolean).join(" · ")}</p>
        </div>
        <FollowStudio slug={p.slug} following={p.following} followers={p.followers} premieres={p.premieres} countries={p.countries} website={p.website} signedIn={Boolean(me)} />
      </header>
      {p.bio && <p className="sp-bio">{p.bio}</p>}
      <section className="sp-sec" aria-labelledby="sp-coming">
        <h2 id="sp-coming">Coming premieres</h2>
        {p.coming.length
          ? <div className="sp-grid">{p.coming.map((f) => <Card key={f.showtimeId} f={f} />)}</div>
          : <p className="sp-empty">No premieres announced yet. Follow to hear when the next one is.</p>}
      </section>
      {p.past.length > 0 && (
        <section className="sp-sec" aria-labelledby="sp-past">
          <h2 id="sp-past">Past premieres</h2>
          <div className="sp-grid">{p.past.map((f) => <Card key={f.showtimeId} f={f} past />)}</div>
        </section>
      )}
      <p className="sp-foot">Follow to hear when {p.name} announces a premiere: one notification per new film, never more.</p>
    </div>
  );
  return me ? <DashShell>{body}</DashShell> : body;
}
