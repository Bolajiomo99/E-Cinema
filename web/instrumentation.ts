// Runs once when the server starts. Keeps studio-published premieres in the catalog, moves AI dubs along sends due announcements and the email outbox, refunds withdrawn premieres and charges shop instalments.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLiveCatalog } = await import("@/lib/live-catalog");
  startLiveCatalog();
  const { startDubWorker } = await import("@/lib/dub-worker");
  startDubWorker();
  const { startCampaignWorker } = await import("@/lib/campaign-worker");
  startCampaignWorker();
  const { startMailWorker } = await import("@/lib/mail-worker");
  startMailWorker();
  const { startRefundWorker } = await import("@/lib/refund-worker");
  startRefundWorker();
  const { startInstalmentWorker } = await import("@/lib/instalment-worker");
  startInstalmentWorker();
}

// Server-side crashes while rendering a page or running a route: reported to the API so the
// tech team gets an error alert (the API groups repeats and limits the emails).
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const digest = (e as Error & { digest?: string }).digest;
    if (digest === "NEXT_NOT_FOUND" || digest?.startsWith("NEXT_REDIRECT") || digest?.startsWith("NEXT_HTTP_ERROR")) return;
    const { accountApi } = await import("@/lib/auth");
    await accountApi("POST", "/v1/errors", {
      source: "web", message: e.message.slice(0, 500), stack: (e.stack ?? "").slice(0, 4000),
      path: `${request.method} ${context.routePath ?? request.path.split("?")[0]}`.slice(0, 300), release: process.env.RENDER_GIT_COMMIT ?? "",
    });
  } catch {
    // never let reporting break the response
  }
}
