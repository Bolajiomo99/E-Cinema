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
let api, paypal;
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
