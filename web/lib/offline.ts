// Encrypted downloads in the browser (Figma 31:743). The film arrives from our server, is cut
// into 4 MB pieces and each piece is sealed with AES-GCM under a key made on this device. The
// key is stored as a non-extractable CryptoKey, so it can be used here but never read out, and
// the pieces are useless anywhere else. Playback decrypts into memory only.

const DB = "ec-downloads";
const CHUNK = 4 * 1024 * 1024;

export type LocalFile = {
  id: string; // showtime id
  film: string;
  quality: "sd" | "hd";
  size: number;
  chunks: number;
  done: boolean;
  audio: string[];
  expiresAt: string;
  savedAt: string;
  credit: string; // attribution shown under the player
  key: CryptoKey;
};

export type Settings = { limitGB: number; wifiOnly: boolean; smart: boolean };
const SETTINGS = "ec.downloads.settings";
export const DEFAULT_SETTINGS: Settings = { limitGB: 20, wifiOnly: true, smart: true };

export function readSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS, JSON.stringify(s));
  } catch {}
}

// A random id for this browser, so licences can be counted per device.
export function deviceId(): string {
  try {
    let id = localStorage.getItem("ec.device");
    if (!id || !/^[a-z0-9]{24}$/.test(id)) {
      const b = crypto.getRandomValues(new Uint8Array(24));
      id = Array.from(b, (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("");
      localStorage.setItem("ec.device", id);
    }
    return id;
  } catch {
    return "";
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("files", { keyPath: "id" });
      r.result.createObjectStore("chunks");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: "files" | "chunks", mode: IDBTransactionMode = "readonly") {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function localFiles(): Promise<LocalFile[]> {
  return req((await store("files")).getAll() as IDBRequest<LocalFile[]>);
}

export async function localFile(id: string): Promise<LocalFile | undefined> {
  return req((await store("files")).get(id) as IDBRequest<LocalFile | undefined>);
}

export async function removeLocal(id: string) {
  const f = await localFile(id);
  const chunks = await store("chunks", "readwrite");
  for (let i = 0; i < (f?.chunks ?? 0) + 1; i++) chunks.delete(`${id}:${i}`);
  await req((await store("files", "readwrite")).delete(id));
}

export async function setExpiry(id: string, expiresAt: string) {
  const f = await localFile(id);
  if (f) await req((await store("files", "readwrite")).put({ ...f, expiresAt }));
}

export type Progress = { received: number; total: number; startedAt: number };

// Download, seal and store a film. Pieces are written as they arrive, so memory stays small.
export async function download(id: string, film: string, quality: "sd" | "hd", audio: string[], expiresAt: string, maxBytes: number, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<LocalFile> {
  const device = deviceId();
  const res = await fetch(`/api/downloads/${id}/${device}/file`, { signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The download could not start");
  const total = Number(res.headers.get("Content-Length") ?? 0);
  if (total > maxBytes) {
    res.body.cancel().catch(() => undefined);
    throw new Error(`Not enough space for ${film}. Delete a download or raise the limit in storage settings.`);
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const credit = decodeURIComponent(res.headers.get("X-Film-Credit") ?? "");
  const file: LocalFile = { id, film, quality, size: total, chunks: 0, done: false, audio, expiresAt, savedAt: new Date().toISOString(), credit, key };
  await req((await store("files", "readwrite")).put(file));

  const reader = res.body.getReader();
  const startedAt = Date.now();
  let buf: Uint8Array<ArrayBuffer> = new Uint8Array(CHUNK);
  let fill = 0;
  let received = 0;
  const seal = async (bytes: Uint8Array) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes as Uint8Array<ArrayBuffer>);
    await req((await store("chunks", "readwrite")).put({ iv, data }, `${id}:${file.chunks}`));
    file.chunks++;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let off = 0;
      while (off < value.length) {
        const n = Math.min(CHUNK - fill, value.length - off);
        buf.set(value.subarray(off, off + n), fill);
        fill += n;
        off += n;
        if (fill === CHUNK) {
          await seal(buf);
          buf = new Uint8Array(CHUNK);
          fill = 0;
        }
      }
      received += value.length;
      if (received > maxBytes) throw new Error(`Not enough space for ${film}. Delete a download or raise the limit in storage settings.`);
      onProgress({ received, total, startedAt });
    }
    if (fill) await seal(buf.subarray(0, fill));
  } catch (err) {
    await removeLocal(id).catch(() => undefined);
    throw err;
  }
  file.done = true;
  file.size = received;
  await req((await store("files", "readwrite")).put(file));
  return file;
}

// Decrypt a stored film into a blob URL that only this tab can play. Revoke it when done.
export async function openLocal(id: string): Promise<string> {
  const f = await localFile(id);
  if (!f?.done) throw new Error("This download is not complete");
  if (Date.parse(f.expiresAt) < Date.now()) throw new Error("This download has expired. Go online to renew it.");
  const parts: ArrayBuffer[] = [];
  for (let i = 0; i < f.chunks; i++) {
    const c = (await req((await store("chunks")).get(`${id}:${i}`))) as { iv: Uint8Array; data: ArrayBuffer } | undefined;
    if (!c) throw new Error("Part of this download is missing. Delete it and download again.");
    parts.push(await crypto.subtle.decrypt({ name: "AES-GCM", iv: c.iv as BufferSource }, f.key, c.data));
  }
  return URL.createObjectURL(new Blob(parts, { type: "video/mp4" }));
}

// How much this site is using, and how much the browser allows.
export async function storageUse(): Promise<{ used: number; quota: number }> {
  const e = await navigator.storage?.estimate?.().catch(() => undefined);
  return { used: e?.usage ?? 0, quota: e?.quota ?? 0 };
}

// Smart downloads: data saver on metered or slow connections, or when space is tight.
export function smartQuality(freeBytes: number): "sd" | "hd" {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; type?: string } }).connection;
  if (c?.saveData || c?.type === "cellular" || (c?.effectiveType && c.effectiveType !== "4g")) return "sd";
  return freeBytes < 3 * 1024 ** 3 ? "sd" : "hd";
}

// Wi-Fi only: where the browser can tell, refuse a mobile connection.
export function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { type?: string } }).connection;
  return c?.type === "cellular";
}
