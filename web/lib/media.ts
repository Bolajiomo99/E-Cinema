import "server-only";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Private media in Cloudflare R2. Viewers only ever get short-lived signed links.
const BUCKET = process.env.R2_BUCKET ?? "e-cinema-media";
const LINK_SECONDS = 15 * 60;
export const FILM_ID = /^[a-z0-9-]{1,80}$/;
export const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

let client: S3Client | undefined;
export const mediaEnabled = Boolean(process.env.R2_ENDPOINT && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

function s3(): S3Client {
  client ??= new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  return client;
}

export interface DubClip {
  start: number;
  end: number;
  text: string;
  url: string;
}

export async function dubLanguages(film: string): Promise<string[]> {
  const res = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `dubs/${film}/`, Delimiter: "/" }));
  return (res.CommonPrefixes ?? [])
    .map((p) => p.Prefix!.split("/")[2])
    .filter((l) => LANG.test(l))
    .sort();
}

export async function dubTrack(film: string, lang: string): Promise<DubClip[] | null> {
  let manifest: { clips: { start: number; end: number; key: string; text: string }[] };
  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: `dubs/${film}/${lang}/manifest.json` }));
    manifest = JSON.parse(await obj.Body!.transformToString());
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
  const prefix = `dubs/${film}/${lang}/`;
  return Promise.all(
    manifest.clips
      .filter((c) => c.key.startsWith(prefix)) // never sign anything outside this track
      .map(async (c) => ({
        start: c.start,
        end: c.end,
        text: c.text,
        url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: c.key }), { expiresIn: LINK_SECONDS }),
      })),
  );
}

export interface FilmStream {
  hd: string;
  sd: string;
  title: string;
  credit: string;
  license: string;
  durationSec: number;
}

// Until studios upload their own films, every room plays the same freely licensed stand-in.
const STAND_IN = "films/stand-in";

// Signed links to a screening's film, valid until shortly after it ends so a viewer who
// joins at the start keeps playing, and useless to anyone once the screening is over.
export async function filmStream(endsAt: Date): Promise<FilmStream | null> {
  let info: { title: string; credit: string; license: string; durationSec: number };
  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: `${STAND_IN}/info.json` }));
    info = JSON.parse(await obj.Body!.transformToString());
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
  const seconds = Math.min(6 * 3600, Math.max(LINK_SECONDS, Math.ceil((endsAt.getTime() - Date.now()) / 1000) + 1800));
  const sign = (key: string) => getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: seconds });
  const [hd, sd] = await Promise.all([sign(`${STAND_IN}/feature-720p.mp4`), sign(`${STAND_IN}/feature-360p.mp4`)]);
  return { hd, sd, ...info, durationSec: Number(info.durationSec) };
}

// A film's trailer: the studio's own upload at trailers/<film>.mp4 when there is one,
// otherwise the opening two minutes of the stand-in film, labelled as such.
export async function trailer(film: string): Promise<{ url: string; studio: boolean; endSec?: number; credit?: string } | null> {
  const key = `trailers/${film}.mp4`;
  try {
    await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: "bytes=0-0" }));
    return { url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: LINK_SECONDS }), studio: true };
  } catch (err) {
    if ((err as { name?: string }).name !== "NoSuchKey") throw err;
  }
  const stand = await filmStream(new Date());
  return stand ? { url: stand.sd, studio: false, endSec: 120, credit: `${stand.title} · ${stand.credit} · ${stand.license}` } : null;
}

// Watch-room uploads (voice notes, photos, files) live under rooms/<showtime>/ and are only
// ever handed out through the room's own media route, which checks the viewer's ticket.
export async function putRoomObject(key: string, body: Buffer, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: "private, max-age=86400" }));
}

// The bytes of a stored upload, for server-side checks such as the AI look at report photos.
export async function objectBytes(key: string): Promise<{ body: Buffer; type: string } | null> {
  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return { body: Buffer.from(await obj.Body!.transformToByteArray()), type: obj.ContentType ?? "image/jpeg" };
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function roomObjectLink(key: string) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: LINK_SECONDS });
}

// The film's bytes for an encrypted download, streamed through our server so the browser
// never holds a reusable link. Until studios upload their own films this is the stand-in.
export async function filmFile(quality: "sd" | "hd"): Promise<{ body: ReadableStream; size: number; credit: string } | null> {
  try {
    const info = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: `${STAND_IN}/info.json` }));
    const i = JSON.parse(await info.Body!.transformToString()) as { title: string; credit: string; license: string };
    const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: `${STAND_IN}/feature-${quality === "hd" ? "720p" : "360p"}.mp4` }));
    if (!obj.Body) return null;
    return { body: obj.Body.transformToWebStream(), size: Number(obj.ContentLength ?? 0), credit: `Stand-in film: ${i.title} ${i.credit} · ${i.license}` };
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

// A byte range of the screening's film, for the VR cinema: a headset draws the film onto a
// WebGL screen, which needs the video from our own origin. Gated by the room's ticket check.
export async function filmRange(quality: "sd" | "hd", range: string | null): Promise<{ body: ReadableStream; status: number; headers: Record<string, string> } | null> {
  try {
    const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: `${STAND_IN}/feature-${quality === "hd" ? "720p" : "360p"}.mp4`, Range: range ?? undefined }));
    if (!obj.Body) return null;
    const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "Content-Length": String(obj.ContentLength ?? 0) };
    if (obj.ContentRange) headers["Content-Range"] = obj.ContentRange;
    return { body: obj.Body.transformToWebStream(), status: obj.ContentRange ? 206 : 200, headers };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey") return null;
    if (name === "InvalidRange") return { body: new ReadableStream({ start: (c) => c.close() }), status: 416, headers: {} };
    throw err;
  }
}
