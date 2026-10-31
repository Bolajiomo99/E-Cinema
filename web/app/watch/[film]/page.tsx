import { notFound } from "next/navigation";
import DubbedPlayer from "@/components/DubbedPlayer";
import SiteFooter from "@/components/SiteFooter";
import { FILM_ID } from "@/lib/media";

const TITLES: Record<string, string> = {
  "red-earth-sample": "Red Earth · trailer lines",
};

export const metadata = { title: "Watch · E-Cinema" };

export default async function WatchPage({ params }: { params: Promise<{ film: string }> }) {
  const { film } = await params;
  if (!FILM_ID.test(film)) notFound();
  const title = TITLES[film] ?? film.replace(/-/g, " ");
  return (
    <section className="watch">
      <h1>{title}</h1>
      <p className="sub">AI dubbed with Claude and ElevenLabs. Pick a language and switch at any moment.</p>
      <DubbedPlayer film={film} title={title} />
      <SiteFooter />
    </section>
  );
}
