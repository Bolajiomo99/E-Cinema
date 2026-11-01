import { Batches, OrderLabels } from "@/components/licensing/CodesTools";
import { accountApi } from "@/lib/auth";
import { partnerPage, session } from "@/lib/licensing";
import type { Codes, Product } from "@/lib/licensing-types";
import { COUNTRIES, countryName, dots, MAP_H, MAP_W, project } from "@/lib/worldmap";

// Figma "Licensee / Authenticity codes" (116:532).
const LAND = dots();
// Cities buyers most often scan in; anywhere else is placed at its country's main city.
const CITY: Record<string, [number, number]> = {
  Lagos: [6.5, 3.4], Abuja: [9.06, 7.49], Kano: [12, 8.52], Kaduna: [10.52, 7.44], "Port Harcourt": [4.82, 7.03], Ibadan: [7.38, 3.94], Onitsha: [6.15, 6.79], Aba: [5.11, 7.37],
  Enugu: [6.45, 7.5], "Benin City": [6.34, 5.63], Jos: [9.9, 8.86], Accra: [5.6, -0.2], Kumasi: [6.69, -1.62], Nairobi: [-1.3, 36.8], Johannesburg: [-26.2, 28.05],
  London: [51.5, -0.13], Manchester: [53.48, -2.24], Houston: [29.76, -95.37], "New York": [40.71, -74], Toronto: [43.65, -79.38], Dubai: [25.2, 55.27], Paris: [48.86, 2.35],
};

export default async function PartnerCodes() {
  const s = await session();
  const [c, pr] = await Promise.all([partnerPage<Codes>(s, "codes"), accountApi("GET", "/v1/me/partner/products", undefined, s)]);
  if (!c) return <p className="pt-empty">Codes could not load. Refresh to try again.</p>;
  const live = pr.status === 200 ? (pr.body as { products: Product[] }).products.filter((p) => p.status === "live").map((p) => ({ id: p.id, name: p.name })) : [];
  const max = Math.max(1, ...c.places.map((p) => p.value));
  const spots = c.places.map((p) => {
    const ll = CITY[p.name] ?? (COUNTRIES[p.country ?? p.name] ? [COUNTRIES[p.country ?? p.name].lat, COUNTRIES[p.country ?? p.name].lon] : null);
    return ll ? { ...project(ll[0], ll[1]), r: 10 + (p.value / max) * 18, p } : null;
  }).filter(Boolean) as { x: number; y: number; r: number; p: Codes["places"][number] }[];
  return (
    <div className="pt-body">
      <header className="bp-head">
        <div>
          <h1>Authenticity codes</h1>
          <p>Every item carries a one-time QR code and hologram. Buyers scan it on <a href="/verify">e-cinema.net/verify</a></p>
        </div>
        <OrderLabels products={live} />
      </header>
      <div className="bp-kpis">
        <div className="bp-kpi"><span>Labels issued</span><b>{c.issued.toLocaleString("en-GB")}</b><em>{c.onSold.toLocaleString("en-GB")} on sold items</em></div>
        <div className="bp-kpi"><span>Genuine scans</span><b>{c.genuine.toLocaleString("en-GB")}</b><em>first scan of a real code</em></div>
        <div className="bp-kpi"><span>Suspicious scans</span><b>{c.suspicious.toLocaleString("en-GB")}</b><em className={c.suspicious ? "neg" : "muted"}>same code in many places</em></div>
        <div className="bp-kpi"><span>Fakes taken down</span><b>{c.takenDown}</b><em className="muted">this year</em></div>
      </div>
      <div className="pt-row c">
        <section className="bp-panel">
          <h2>Where codes are scanned</h2>
          <div className="pt-map">
            <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Map of where buyers scanned your codes">
              {LAND.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="3.2" fill="#2c3746" />)}
              {spots.map(({ x, y, r, p }) => (
                <g key={p.name}><title>{`${/^[A-Z]{2}$/.test(p.name) ? countryName(p.name) : p.name}: ${p.value.toLocaleString("en-GB")} scans`}</title><circle cx={x} cy={y} r={r * 1.8} fill="#2bb3a3" fillOpacity=".2" /><circle cx={x} cy={y} r={r / 2} fill="#2bb3a3" /></g>
              ))}
            </svg>
            <p>{c.places.length ? c.places.slice(0, 5).map((p) => `${/^[A-Z]{2}$/.test(p.name) ? countryName(p.name) : p.name} ${p.value.toLocaleString("en-GB")}`).join(" · ") : "No scans yet. They appear here as buyers check their labels."}</p>
          </div>
        </section>
        <section className="bp-panel">
          <h2>Suspicious codes</h2>
          {c.list.length ? (
            <table className="pt-table">
              <thead><tr><th>Code</th><th>Scans</th><th>Cities</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {c.list.map((x) => (
                  <tr key={x.code}>
                    <td className="strong">{x.code}{!x.ours && <small>Never issued</small>}</td>
                    <td>{x.scans}</td>
                    <td>{x.cities.slice(0, 2).join(", ")}{x.cities.length > 2 ? ` +${x.cities.length - 2}` : ""}</td>
                    <td><a className="vf-btn soft sm" href={`/rewards/report?code=${x.code}`}>Report</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="pt-empty">No suspicious codes. A code scanned in many far-apart places shows here.</p>}
        </section>
      </div>
      <p className="pt-note">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2bb3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
        Codes are signed by E‑Cinema and can only be printed by our label partner. A code scanned in two far-apart places is flagged automatically.
      </p>
      <Batches batches={c.batches} />
    </div>
  );
}
