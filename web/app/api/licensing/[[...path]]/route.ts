import type { NextRequest } from "next/server";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import { accountApi, currentAccount } from "@/lib/auth";
import { showtimes } from "@/lib/catalog";
import { aiEnabled, brandRules, readCertificate, session } from "@/lib/licensing";
import type { Application, Check, Product } from "@/lib/licensing-types";
import { readLocale } from "@/lib/locale";
import { mediaEnabled, objectBytes, putRoomObject, roomObjectLink } from "@/lib/media";
import { paypalError, paypalOrders } from "@/lib/paypal";
import { json, sameOrigin } from "@/lib/room-gate";
import { chargeFor, isStaff } from "@/lib/store";

// Licensed merch partners (Figma 114:1933, 116:38 to 116:726): the application with its AI
// document check and licence fee, the partner portal, and the brand team's desk.
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const UUID = /^[0-9a-f-]{36}$/;
const KEY = /^licensing\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const pass = (r: { status: number; body: unknown }) => json(r.status, r.body ?? {});
const uploads = new Map<string, number[]>();

function limited(key: string, max: number) {
  const now = Date.now();
  const recent = (uploads.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= max) return true;
  uploads.set(key, [...recent, now]);
  if (uploads.size > 5000) uploads.clear();
  return false;
}

async function sign(keys: string[]) {
  return mediaEnabled ? Promise.all(keys.filter((k) => KEY.test(k)).map((k) => roomObjectLink(k))) : [];
}

// Stores an uploaded file under licensing/ after checking it really is what it says.
async function store(req: NextRequest, allowPdf: boolean): Promise<{ key: string; buf: Buffer; type: string } | Response> {
  if (!mediaEnabled) return json(503, { error: "Uploads are paused right now" });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json(400, { error: "Choose a file" });
  const type = file.type.split(";")[0];
  if (!TYPES[type] || (type === "application/pdf" && !allowPdf)) return json(400, { error: allowPdf ? "Use a PDF, JPG or PNG" : "Pictures must be JPG, PNG or WebP" });
  if (file.size === 0 || file.size > 12 << 20) return json(400, { error: "That file is too big (up to 12 MB)" });
  const buf = Buffer.from(await file.arrayBuffer());
  const head = buf.subarray(0, 12).toString("latin1");
  const ok = type === "application/pdf" ? head.startsWith("%PDF") : /^\xff\xd8|^\x89PNG|^RIFF[^]{4}WEBP/.test(head);
  if (!ok) return json(400, { error: "That file does not look like what it says it is" });
  const key = `licensing/${randomUUID()}.${TYPES[type]}`;
  await putRoomObject(key, buf, type);
  return { key, buf, type };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });
  if (p[0] === "application") return pass(await accountApi("GET", "/v1/me/licence-application", undefined, s));

  if (p[0] === "partner" && p[1] === "batch" && /^[A-Z0-9-]{6,40}$/.test(p[2] ?? "")) {
    // The label file for the printer: one code and its check link per line.
    const r = await accountApi("GET", `/v1/me/partner/codes/${p[2]}`, undefined, s);
    if (r.status !== 200) return pass(r);
    const b = r.body as { codes: string[]; product: string; licence: string };
    const site = process.env.SITE_URL ?? "https://e-cinema.net";
    const csv = ["code,product,licence,check_link", ...b.codes.map((c) => `${c},"${b.product.replace(/"/g, '""')}",${b.licence},${site}/verify?code=${c}`)].join("\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="e-cinema-labels-${p[2]}.csv"` } });
  }
  if (p[0] === "partner" && /^[a-z]{4,12}$/.test(p[1] ?? "")) {
    const r = await accountApi("GET", `/v1/me/partner/${p[1]}`, undefined, s);
    if (r.status !== 200 || p[1] !== "products") return pass(r);
    const list = (r.body as { products: Product[] }).products;
    return json(200, { products: await Promise.all(list.map(async (x) => ({ ...x, image: (await sign([x.imageKey]))[0], sample: (await sign([x.sampleKey]))[0] }))) });
  }

  if (p[0] === "desk") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    const r = await accountApi("GET", "/v1/licensing/applications");
    if (r.status !== 200) return pass(r);
    const b = r.body as { applications: Application[]; products: Product[] };
    return json(200, {
      applications: await Promise.all(b.applications.map(async (a) => ({ ...a, doc: (await sign([a.docKey]))[0], photoLinks: await sign(a.photos) }))),
      products: await Promise.all(b.products.map(async (x) => ({ ...x, image: (await sign([x.imageKey]))[0], sample: (await sign([x.sampleKey]))[0] }))),
    });
  }
  return json(404, { error: "Not found" });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });
  const body = await req.json().catch(() => ({}));
  if (p[0] === "application" && !p[1]) return pass(await accountApi("PUT", "/v1/me/licence-application", body, s));
  if (p[0] === "application" && p[1] === "photos") return pass(await accountApi("PUT", "/v1/me/licence-application/photos", body, s));
  if (p[0] === "partner" && (p[1] === "settings" || p[1] === "payout")) return pass(await accountApi("PUT", `/v1/me/partner/${p[1]}`, body, s));
  return json(404, { error: "Not found" });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  if (!sameOrigin(req)) return json(403, { error: "forbidden" });
  const p = (await params).path ?? [];
  const s = await session();
  if (!s) return json(401, { error: "Sign in first", signIn: true });

  // Uploads: a photo or design picture is just stored; the certificate is also read by AI.
  if (p[0] === "upload") {
    if (limited(s, 15)) return json(429, { error: "Slow down: too many uploads" });
    const kind = p[1];
    if (kind === "doc") {
      const app = await accountApi("GET", "/v1/me/licence-application", undefined, s);
      const a = (app.body as { application: Application | null }).application;
      if (!a) return json(400, { error: "Save your company details first" });
      const up = await store(req, true);
      if (up instanceof Response) return up;
      let note = "Uploaded · the brand team will read it", ok = false;
      if (aiEnabled()) {
        try {
          const d = await readCertificate(up.buf, up.type, a.company, a.regNumber);
          ok = d.isRegistration && d.matches;
          note = !d.isRegistration ? "This does not look like a registration certificate" : ok ? `Checked by AI · ${d.company}, ${d.number}` : `AI check: ${d.note}`;
        } catch (err) {
          console.error("certificate check failed", (err as Error).message);
        }
      }
      return pass(await accountApi("PUT", "/v1/me/licence-application/doc", { key: up.key, note, ok }, s));
    }
    if (kind === "photo" || kind === "design") {
      const up = await store(req, false);
      return up instanceof Response ? up : json(200, { key: up.key, url: (await sign([up.key]))[0] });
    }
    return json(404, { error: "Not found" });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (p[0] === "application" && p[1] === "submit") return pass(await accountApi("POST", "/v1/me/licence-application/submit", {}, s));

  // The licence fee, charged with PayPal in the payer's currency (US dollars from Nigeria).
  if (p[0] === "application" && p[1] === "pay") {
    const r = await accountApi("GET", "/v1/me/licence-application", undefined, s);
    const a = (r.body as { application: Application | null }).application;
    if (!a || a.status !== "approved" || a.feeNgn <= 0) return json(409, { error: "Your application is not ready for payment" });
    const charge = await chargeFor(a.feeNgn, (await readLocale()).country);
    if (!charge) return json(503, { error: "Payments are briefly unavailable. Try again shortly." });
    const value = (charge.cents / 100).toFixed(2);
    try {
      const { result } = await paypalOrders().createOrder({
        paypalRequestId: randomUUID(),
        prefer: "return=minimal",
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [{
            referenceId: "licence",
            customId: `licence:${a.id}`,
            description: `E-Cinema merch licence, ${a.plan} plan, one year`,
            amount: { currencyCode: charge.currency, value, breakdown: { itemTotal: { currencyCode: charge.currency, value } } },
            items: [{ name: `E-Cinema ${a.plan} licence · ${a.company}`.slice(0, 127), quantity: "1", unitAmount: { currencyCode: charge.currency, value } }],
          }],
        },
      });
      if (!result.id) return json(502, { error: "PayPal did not return an order" });
      const at = await accountApi("POST", "/v1/me/licence-application/payment", { orderId: result.id }, s);
      return at.status === 200 ? json(200, { orderId: result.id }) : pass(at);
    } catch (err) {
      return paypalError(err);
    }
  }

  // The partner portal.
  if (p[0] === "partner") {
    if (p[1] === "products" && !p[2]) {
      const key = String(body.imageKey ?? "");
      if (!KEY.test(key)) return json(400, { error: "Add a picture of the design" });
      const film = String(body.film ?? "").slice(0, 80);
      const checks = await rules(key, film, "");
      return pass(await accountApi("POST", "/v1/me/partner/products", { name: body.name, detail: body.detail, priceNgn: Number(body.priceNgn), film, imageKey: key, checks }, s));
    }
    if (p[1] === "products" && UUID.test(p[2] ?? "")) {
      const imageKey = String(body.imageKey ?? ""), sampleKey = String(body.sampleKey ?? "");
      let checks: Check[] | undefined;
      if (imageKey && KEY.test(imageKey)) checks = await rules(imageKey, String(body.film ?? ""), sampleKey);
      else if (sampleKey && Array.isArray(body.checks)) checks = (body.checks as Check[]).map((c) => (c.name === "Quality sample" ? { ...c, detail: "Printed sample photo added", result: "pass" as const } : c));
      return pass(await accountApi("PUT", `/v1/me/partner/products/${p[2]}`, { imageKey, sampleKey, checks }, s));
    }
    if (p[1] === "sales") return pass(await accountApi("POST", "/v1/me/partner/sales", body, s));
    if (p[1] === "codes") return pass(await accountApi("POST", "/v1/me/partner/codes", { productId: body.productId, count: Number(body.count) }, s));
    if (p[1] === "members") return pass(await accountApi("POST", "/v1/me/partner/members", body, s));
  }

  // The brand team.
  if (p[0] === "desk") {
    const me = await currentAccount();
    if (!isStaff(me?.email)) return json(403, { error: "Staff only" });
    if (p[1] === "applications" && UUID.test(p[2] ?? "")) return pass(await accountApi("POST", `/v1/licensing/applications/${p[2]}/review`, body));
    if (p[1] === "products" && UUID.test(p[2] ?? "")) return pass(await accountApi("POST", `/v1/licensing/products/${p[2]}/decide`, body));
    if (p[1] === "settle" && /^[A-Z]{2}-\d{4}$/.test(p[2] ?? "")) return pass(await accountApi("POST", `/v1/licensing/${p[2]}/settle`, body));
  }
  return json(404, { error: "Not found" });
}

// The brand rules check a design gets before a person looks at it.
async function rules(imageKey: string, film: string, sampleKey: string): Promise<Check[]> {
  const sample: Check = sampleKey ? { name: "Quality sample", detail: "Printed sample photo added", result: "pass" } : { name: "Quality sample", detail: "Photo of a printed sample needed", result: "needed" };
  if (!aiEnabled() || !mediaEnabled) return [{ name: "Logo colour and spacing", detail: "The brand team checks this by hand", result: "needed" }, sample];
  try {
    const img = await objectBytes(imageKey);
    if (!img) return [sample];
    const films = [...new Set(showtimes.map((x) => x.film))];
    return [...(await brandRules(img.body, img.type, film, films)), sample];
  } catch (err) {
    console.error("brand rules check failed", (err as Error).message);
    return [{ name: "Logo colour and spacing", detail: "The brand team checks this by hand", result: "needed" }, sample];
  }
}
