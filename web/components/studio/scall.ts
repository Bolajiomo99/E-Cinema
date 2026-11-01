// Browser calls to the studio API route.
export async function scall<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const r = await fetch(`/api/studio${path ? `/${path}` : ""}`, { method, headers: form || !body ? undefined : { "content-type": "application/json" }, body: form ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong");
  return j as T;
}
