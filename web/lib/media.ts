import "server-only";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
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
