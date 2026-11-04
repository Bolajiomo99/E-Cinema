// Runs once when the server starts. Keeps studio-published premieres in the catalog, moves AI dubs along sends due announcements and the email outbox, and refunds withdrawn premieres.
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
}
