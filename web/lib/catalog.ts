// Showtimes and prices live on the server so a browser can never change what it pays.
export type Showtime = {
  id: string;
  film: string;
  studio: string;
  startsAt: string; // ISO time
  price: { currency: string; value: string };
  shopQuery: string; // what "Shop the film" searches for
};

export const showtimes: Showtime[] = [
  { id: "red-earth-2026-11-02", film: "Red Earth", studio: "Lagoon Gate Pictures", startsAt: "2026-11-02T19:00:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "red ankara print shirt" },
  { id: "seoul-after-rain-2026-11-03", film: "Seoul After Rain", studio: "Hanbit Story House", startsAt: "2026-11-03T13:00:00Z", price: { currency: "USD", value: "5.49" }, shopQuery: "clear rain umbrella" },
  { id: "lagos-lights-2026-11-04", film: "Lagos Lights", studio: "Lagoon Gate Pictures", startsAt: "2026-11-04T20:00:00Z", price: { currency: "USD", value: "6.99" }, shopQuery: "neon city graphic tee" },
];

export function findShowtime(id: string): Showtime | undefined {
  return showtimes.find((s) => s.id === id);
}
