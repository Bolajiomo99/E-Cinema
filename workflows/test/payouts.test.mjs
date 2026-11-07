// End-to-end test of the payout tasks against the real Go API, a real Postgres and a fake PayPal.
// Needs TEST_DATABASE_URL and a built API binary at API_BIN (see the CI workflow).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";

const DB = process.env.TEST_DATABASE_URL;
const BIN = process.env.API_BIN;
const skip = !DB || !BIN ? "TEST_DATABASE_URL and API_BIN are required" : false;

const sql = (q) => execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-qAtc", q], { encoding: "utf8" }).trim();
let api, paypal, flw;
const transfers = [];
let transferOutcome = "SUCCESSFUL";
const payouts = [];
const seen = new Set();

before(async () => {
  if (skip) return;
  paypal = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/oauth2/token") return res.end(JSON.stringify({ access_token: "fake", expires_in: 3600 }));
      const p = JSON.parse(body);
      const id = p.sender_batch_header.sender_batch_id;
      if (seen.has(id)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ name: "USER_BUSINESS_ERROR", details: [{ issue: "SENDER_BATCH_ID_ALREADY_EXISTS" }] }));
      }
      seen.add(id);
      payouts.push(p);
      res.statusCode = 201;
      res.end(JSON.stringify({ batch_header: { payout_batch_id: `BATCH-${payouts.length}`, batch_status: "PENDING" } }));
    });
  }).listen(0);
  await new Promise((r) => paypal.once("listening", r));
  // Fake Flutterwave: rates at 1 USD = 1,500 NGN, transfers settle on the first status check.
  flw = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      const u = new URL(req.url, "http://x");
      if (req.headers.authorization !== "Bearer FLWSECK_TEST-fake") { res.statusCode = 401; return res.end("{}"); }
      if (u.pathname === "/transfers/rates") {
        const amount = Number(u.searchParams.get("amount"));
        return res.end(JSON.stringify({ status: "success", data: { rate: 1500, source: { currency: "USD", amount }, destination: { currency: "NGN", amount: amount * 1500 } } }));
      }
      if (req.method === "POST" && u.pathname === "/transfers") {
        const t = JSON.parse(body);
        if (transfers.some((x) => x.reference === t.reference)) { res.statusCode = 400; return res.end(JSON.stringify({ status: "error", message: "Transfer with this reference already exists" })); }
        if (t.account_number === "0000000000") { res.statusCode = 400; return res.end(JSON.stringify({ status: "error", message: "Invalid account number" })); }
        transfers.push({ ...t, id: 9000 + transfers.length });
        return res.end(JSON.stringify({ status: "success", data: { id: 9000 + transfers.length - 1, status: "NEW" } }));
      }
      const m = u.pathname.match(/^\/transfers\/(\d+)$/);
      if (m) return res.end(JSON.stringify({ status: "success", data: { id: Number(m[1]), status: transferOutcome, complete_message: transferOutcome === "FAILED" ? "Account closed" : "Successful" } }));
      res.statusCode = 404; res.end("{}");
    });
  }).listen(0);
  await new Promise((r) => flw.once("listening", r));
  process.env.FLW_API_BASE = `http://127.0.0.1:${flw.address().port}`;
  process.env.FLW_SECRET_KEY = "FLWSECK_TEST-fake";
  process.env.FLW_POLL_MS = "10";

  const port = 18000 + Math.floor(Math.random() * 1000);
  api = spawn(BIN, [], { env: { ...process.env, DATABASE_URL: DB, INTERNAL_API_TOKEN: "test-token", PORT: String(port) }, stdio: "ignore" });
  process.env.API_URL = `http://127.0.0.1:${port}`;
  process.env.INTERNAL_API_TOKEN = "test-token";
  process.env.PAYPAL_API_BASE = `http://127.0.0.1:${paypal.address().port}`;
  process.env.PAYPAL_CLIENT_ID = "id";
  process.env.PAYPAL_CLIENT_SECRET = "secret";
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${process.env.API_URL}/healthz`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  // Close any other due screenings so this test only sees its own.
  sql(`INSERT INTO studio_payouts (showtime_id, studio, paid_seats, gross_cents, studio_cents, currency, status)
       SELECT s.id, st.name, 0, 0, 0, s.currency, 'nothing_due' FROM showtimes s JOIN studios st ON st.name = s.studio
       WHERE s.starts_at + make_interval(mins => s.duration_min) < now() ON CONFLICT DO NOTHING`);
  // Ended screenings of studios not on file (other packages' test rows) move out of the way;
  // deleting them would break the rows other tables keep pointing at them.
  sql(`UPDATE showtimes s SET starts_at = now() + interval '30 days' WHERE s.starts_at + make_interval(mins => s.duration_min) < now()
       AND s.id <> 'wf-ended' AND NOT EXISTS (SELECT 1 FROM studio_payouts p WHERE p.showtime_id = s.id AND p.status IN ('sent', 'nothing_due'))`);
  sql(`DELETE FROM studio_payouts WHERE showtime_id = 'wf-ended'; DELETE FROM holds WHERE showtime_id = 'wf-ended';
       DELETE FROM showtimes WHERE id = 'wf-ended';
       INSERT INTO showtimes VALUES ('wf-ended', 'Night Market', 'Lagoon Gate Pictures', now() - interval '4 hours', 120, 100, 699, 'USD');
       INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, paypal_order_id, paypal_capture_id)
       VALUES ('wf-ended', 3, 'v1', 'paid', now(), 'WFORDER1', 'WFCAP1'), ('wf-ended', 2, 'v2', 'held', now() + interval '5 minutes', 'WFORDER2', NULL);`);
});

after(() => {
  api?.kill();
  paypal?.close();
  flw?.close();
});

const ctx = { metadata: {}, run: (t, ...args) => t.func(ctx, ...args) };

test("pays each ended screening once, at the studio share of paid seats", { skip }, async () => {
  const { payEndedScreenings } = await import("../dist/payouts.js");
  const first = await payEndedScreenings.func(ctx);
  assert.equal(first.due, 1);
  assert.deepEqual(first.failed, []);
  assert.equal(payouts.length, 1);
  const item = payouts[0].items[0];
  assert.equal(item.amount.value, "14.67"); // 3 paid seats x 6.99 = 20.97, studio keeps 70%
  assert.equal(item.amount.currency, "USD");
  assert.equal(item.receiver, "payouts+lagoongate@e-cinema.net");
  assert.equal(sql(`SELECT status || ' ' || paypal_batch_id FROM studio_payouts WHERE showtime_id = 'wf-ended'`), "sent BATCH-1");

  const second = await payEndedScreenings.func(ctx);
  assert.equal(second.due, 0);
  assert.equal(payouts.length, 1);
});

test("a retry after PayPal already accepted the batch is recorded as sent, not paid twice", { skip }, async () => {
  const { payStudio } = await import("../dist/payouts.js");
  sql(`UPDATE studio_payouts SET status = 'pending', paypal_batch_id = NULL WHERE showtime_id = 'wf-ended'`);
  const r = await payStudio.func(ctx, "wf-ended");
  assert.equal(r.status, "sent");
  assert.equal(payouts.length, 1);
  assert.equal(sql(`SELECT status FROM studio_payouts WHERE showtime_id = 'wf-ended'`), "sent");
});

test("a studio paid by bank gets a Flutterwave transfer in its own currency, retried on refusal", { skip }, async () => {
  const { payStudio } = await import("../dist/payouts.js");
  sql(`DELETE FROM studio_payouts WHERE showtime_id = 'wf-bank'; DELETE FROM holds WHERE showtime_id = 'wf-bank';
       DELETE FROM showtimes WHERE id = 'wf-bank'; DELETE FROM studios WHERE name = 'WF Bank Studio';
       INSERT INTO studios (name, slug, status, payout_email, payout_method, payout_bank, payout_bank_code, payout_number, payout_name, payout_currency, share_bps)
       VALUES ('WF Bank Studio', 'wf-bank-studio', 'verified', '', 'bank', 'Access Bank', '044', '0690000031', 'WF Bank Studio Ltd', 'NGN', 7000);
       INSERT INTO showtimes VALUES ('wf-bank', 'Harmattan', 'WF Bank Studio', now() - interval '4 hours', 120, 100, 1000, 'USD');
       INSERT INTO holds (showtime_id, seats, viewer_ref, status, expires_at, paypal_order_id, paypal_capture_id)
       VALUES ('wf-bank', 2, 'v1', 'paid', now(), 'WFBANK1', 'WFBANKCAP1');`);
  try {
    // First the bank refuses: the payout is marked failed and the next try uses a new reference.
    transferOutcome = "FAILED";
    let r = await payStudio.func(ctx, "wf-bank");
    assert.equal(r.status, "failed");
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].reference, "ecinema-wf-bank");
    assert.equal(transfers[0].amount, 21000); // 2 x 10.00 USD x 70% = 14.00 USD at 1,500
    assert.equal(transfers[0].currency, "NGN");
    assert.equal(transfers[0].account_bank, "044");
    assert.equal(sql(`SELECT status || ' ' || attempts FROM studio_payouts WHERE showtime_id = 'wf-bank'`), "failed 1");

    transferOutcome = "SUCCESSFUL";
    r = await payStudio.func(ctx, "wf-bank");
    assert.equal(r.status, "sent");
    assert.equal(transfers.length, 2);
    assert.equal(transfers[1].reference, "ecinema-wf-bank-1");
    assert.equal(sql(`SELECT status || ' ' || transfer_id || ' ' || paid_currency || ' ' || paid_minor FROM studio_payouts WHERE showtime_id = 'wf-bank'`), "sent 9001 NGN 2100000");
    r = await payStudio.func(ctx, "wf-bank");
    assert.equal(r.status, "sent");
    assert.equal(transfers.length, 2, "never paid twice");
  } finally {
    sql(`DELETE FROM studio_payouts WHERE showtime_id = 'wf-bank'; DELETE FROM holds WHERE showtime_id = 'wf-bank';
         DELETE FROM showtimes WHERE id = 'wf-bank'; DELETE FROM studios WHERE name = 'WF Bank Studio';`);
  }
});
