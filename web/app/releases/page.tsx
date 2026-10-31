import ReleaseCalendar from "@/components/ReleaseCalendar";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { currentAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Release calendar · E-Cinema" };

export default async function ReleasesPage() {
  const me = await currentAccount();
  return (
    <div className="home">
      <div className="hero slim">
        <SiteNav signedIn={Boolean(me)} />
      </div>
      <main className="band">
        <ReleaseCalendar />
      </main>
      <div className="band"><SiteFooter /></div>
    </div>
  );
}
