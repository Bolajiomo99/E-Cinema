import QRCode from "qrcode";
import { accountApi } from "@/lib/auth";
import { session } from "@/lib/licensing";
import PrintButton from "@/components/licensing/PrintButton";

// A printable sheet of QR labels for one batch: each label opens the product checker with its code.
export const metadata = { title: "Print labels · E-Cinema partner" };

export default async function PrintLabels({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const batch = (await searchParams).batch ?? "";
  if (!/^[A-Z0-9-]{6,40}$/.test(batch)) return <p className="pt-empty">Choose a batch on the codes page.</p>;
  const r = await accountApi("GET", `/v1/me/partner/codes/${batch}`, undefined, await session());
  if (r.status !== 200) return <p className="pt-empty">That batch was not found.</p>;
  const b = r.body as { codes: string[]; product: string; licence: string; partner: string };
  const site = process.env.SITE_URL ?? "https://e-cinema.net";
  // A sheet holds up to 5,000 labels; drawing them all at once would make a huge page, so 500 per page.
  const codes = b.codes.slice(0, 500);
  const svgs = await Promise.all(codes.map((c) => QRCode.toString(`${site}/verify?code=${c}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" })));
  return (
    <div className="pcl">
      <header className="pcl-head">
        <div><b>{b.partner} · licence {b.licence}</b><span>{b.product} · batch {batch} · {codes.length < b.codes.length ? `first ${codes.length} of ${b.codes.length.toLocaleString("en-GB")} (use the CSV for the rest)` : `${codes.length} labels`}</span></div>
        <PrintButton />
      </header>
      <div className="pcl-grid">
        {codes.map((c, i) => (
          <div key={c} className="pcl-label">
            <span dangerouslySetInnerHTML={{ __html: svgs[i] }} />
            <div><b>E-CINEMA</b><small>Official merch</small><code>{c}</code><small>{b.licence} · scan to check</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}
