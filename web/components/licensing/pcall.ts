// Browser calls to the licensing API route.
export async function pcall<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const r = await fetch(`/api/licensing/${path}`, { method, headers: form || !body ? undefined : { "content-type": "application/json" }, body: form ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong");
  return j as T;
}

export async function upload(kind: "photo" | "design", file: File): Promise<{ key: string; url?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return pcall("POST", `upload/${kind}`, fd);
}

// A CSV file the browser saves.
export function saveCsv(name: string, rows: (string | number)[][]) {
  const text = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
