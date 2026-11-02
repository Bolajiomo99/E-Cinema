// Runs once when the server starts. Keeps studio-published premieres in the catalog and moves AI dubs along.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLiveCatalog } = await import("@/lib/live-catalog");
  startLiveCatalog();
  const { startDubWorker } = await import("@/lib/dub-worker");
  startDubWorker();
}
