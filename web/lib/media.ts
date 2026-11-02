import "server-only";
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand,
  ListObjectsV2Command, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3";
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
  // Studio dubs (Figma 35:871) keep their voiced lines under studio-dubs/<upload>/<lang>/.
  const studio = new RegExp(`^studio-dubs/[0-9a-f-]{36}/${lang}/[0-9]+-[0-9a-f]+\\.mp3$`);
  return Promise.all(
    manifest.clips
      .filter((c) => c.key.startsWith(prefix) || studio.test(c.key)) // never sign anything outside a dub track
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

// Studio film uploads (Figma 35:290). The browser sends each part straight to storage with a
// short-lived signed link, so masters of up to 2 TB never pass through our servers and a
// dropped connection only loses the part in flight.
export async function startMultipart(key: string, contentType: string): Promise<string> {
  const r = await s3().send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }));
  return r.UploadId!;
}

export async function signPart(key: string, uploadId: string, part: number): Promise<string> {
  return getSignedUrl(s3(), new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: part }), { expiresIn: 60 * 60 });
}

export async function uploadedParts(key: string, uploadId: string): Promise<{ part: number; etag: string; size: number }[]> {
  const out: { part: number; etag: string; size: number }[] = [];
  let marker: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await s3().send(new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
    for (const p of r.Parts ?? []) out.push({ part: p.PartNumber!, etag: p.ETag!, size: p.Size ?? 0 });
    if (!r.IsTruncated) break;
    marker = r.NextPartNumberMarker;
  }
  return out;
}

export async function finishMultipart(key: string, uploadId: string, parts: { part: number; etag: string }[]) {
  await s3().send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.part, ETag: p.etag })) },
  }));
}

export async function dropUpload(key: string, uploadId: string, finished: boolean) {
  if (!finished && uploadId) await s3().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })).catch(() => {});
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}

// A byte range of a stored object, for reading file headers without downloading the file.
export async function objectRange(key: string, start: number, end: number): Promise<Buffer> {
  const obj = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key, Range: `bytes=${start}-${end}` }));
  return Buffer.from(await obj.Body!.transformToByteArray());
}

// Deletes every object under a prefix (a removed dub language's voiced lines), 1,000 at a time.
export async function dropPrefix(prefix: string) {
  for (let i = 0; i < 50; i++) {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000 }));
    const keys = (res.Contents ?? []).map((c) => c.Key!).filter(Boolean);
    if (!keys.length) return;
    for (let j = 0; j < keys.length; j += 20) await Promise.all(keys.slice(j, j + 20).map((k) => s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: k })).catch(() => {})));
    if (!res.IsTruncated) return;
  }
}
