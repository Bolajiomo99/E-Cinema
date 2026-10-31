// Dubbing tasks against fake ElevenLabs and fake R2 servers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

const speech = [];
const stored = new Map();
let eleven, r2;

const listen = (srv) => new Promise((r) => srv.listen(0, () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  eleven = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      assert.equal(req.headers["xi-api-key"], "test-key");
      if (req.url === "/v1/voices") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ voices: [{ voice_id: "cloned", category: "cloned" }, { voice_id: "premade-1", category: "premade" }] }));
      }
      speech.push({ url: req.url, ...JSON.parse(body) });
      res.setHeader("content-type", "audio/mpeg");
      res.end(Buffer.from("ID3fake"));
    });
  });
  r2 = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      stored.set(decodeURIComponent(req.url.split("?")[0]), Buffer.concat(chunks).toString());
      res.setHeader("etag", '"x"');
      res.end();
    });
  });
  process.env.ELEVENLABS_API_BASE = await listen(eleven);
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.R2_ENDPOINT = await listen(r2);
  process.env.R2_ACCESS_KEY_ID = "k";
  process.env.R2_SECRET_ACCESS_KEY = "s";
  process.env.R2_BUCKET = "media";
  delete process.env.ELEVENLABS_VOICE_ID;
});

after(() => {
  eleven.close();
  r2.close();
});

const VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
<i>Where were you</i> last night?

2
00:01:02.250 --> 00:01:04.000 align:start
At the market.
With Tunde.

3
00:01:05.000 --> 00:01:06.000
`;

test("parses cue timings and text", async () => {
  const { parseVtt } = await import("../dist/vtt.js");
  assert.deepEqual(parseVtt(VTT), [
    { start: 1, end: 3.5, text: "Where were you last night?" },
    { start: 62.25, end: 64, text: "At the market. With Tunde." },
  ]);
});

test("voices every line with context and writes a manifest", async () => {
  const { voiceTrack } = await import("../dist/dubbing.js");
  const r = await voiceTrack.func({ metadata: {} }, "red-earth", "fr", VTT);
  assert.deepEqual(r, { language: "fr", lines: 2, manifest: "dubs/red-earth/fr/manifest.json" });
  assert.equal(speech.length, 2);
  assert.match(speech[0].url, /^\/v1\/text-to-speech\/premade-1\?/); // first ready-made voice
  assert.equal(speech[1].previous_text, "Where were you last night?");
  const manifest = JSON.parse(stored.get("/media/dubs/red-earth/fr/manifest.json"));
  assert.equal(manifest.clips.length, 2);
  assert.deepEqual(manifest.clips[1], { start: 62.25, end: 64, key: "dubs/red-earth/fr/00001.mp3", text: "At the market. With Tunde." });
  assert.ok(stored.has("/media/dubs/red-earth/fr/00000.mp3"));
});

test("rejects unsafe film ids", async () => {
  const { voiceTrack } = await import("../dist/dubbing.js");
  await assert.rejects(voiceTrack.func({ metadata: {} }, "../etc", "fr", VTT), /invalid film id/);
});
