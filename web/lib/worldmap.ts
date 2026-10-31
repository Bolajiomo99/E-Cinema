// World dot map from the Figma frame "Web / World map · live" (32:1201).
// The land grid is 98 x 46 dots, 11px apart, inside a 1100 x 520 frame.
// Rows are "row:start-end,col,..." runs of filled columns.
const DOT_ROWS = "0:15,23-24,27-41,52,54|1:15,20-24,31-41,64,73-79,88|2:12,14-17,20,22-25,32-41,63,68-91|3:0-14,17,19-21,23,27-28,32-38,52-59,61,63-68,70-97|5:0-23,25-28,33-35,41-43,51-53,55-57,60-97|6:0-20,25-26,34-35,49-52,54-94,96-97|7:2,9-20,25-29,46,51-52,55-88,94|8:0,10-23,25-30,47,50,54-86,93-94|9:11-30,47,49-89|10:12-28,31-32,47-89|11:12-27,29,48-55,59-61,63-87,89|12:12-26,45-48,52,54-55,57-58,60-61,64-85|14:12-25,45-47,52,54,56-61,64-81,84|15:13-25,46-50,57-82,86-88|16:14-23,45-52,54-55,58-82|17:16-19,24,45-61,63-82|18:15-19,44-57,59-62,67-83|19:17-19,25,43-64,68-73,75-80|20:18-19,21,25-28,43-58,60-63,69-71,75-78|21:21-23,43-62,70,76-79|23:23,43-59,70,78-79,84|24:24-30,44-62,70-71,84|25:25-32,45,47,50-61,77,81-82|26:25-32,51-60,77,80-81|27:24-34,51-59,77,80-81,83,86|28:24-36,51-58,78,88-89|29:25-37,52-58,80-81,89,94|30:25-36,52-59,89|32:26-36,52-59,62,84-86,89|33:27-35,51-58,61,84-90|34:28-35,52-57,61,82-90|35:27-33,52-57,61,81-91|36:27-33,53-56,81-92|37:27-32,53-56,82-92|38:27-30,88-91|39:27-30,89-90|41:26-28,90|42:26-28,97|43:26-28|44:26-27,30|45:27-28";

export const MAP_W = 1100;
export const MAP_H = 520;

export function dots(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const row of DOT_ROWS.split("|")) {
    const [r, runs] = row.split(":");
    for (const run of runs.split(",")) {
      const [a, b = a] = run.split("-").map(Number);
      for (let c = a; c <= b; c++) out.push({ x: 27.5 + 11 * c, y: 6.2 + 11 * Number(r) });
    }
  }
  return out;
}

// The Figma hotspots (Lagos, London, Nairobi, Mumbai, Seoul, São Paulo, Jakarta) fit this projection.
export function project(lat: number, lon: number) {
  return { x: 550 + 3.24 * lon, y: (78 - lat) * 3.82 };
}

// Home countries a viewer can pick, placed at their best-known film city. Country level only.
export const COUNTRIES: Record<string, { name: string; short?: string; city: string; lat: number; lon: number }> = {
  NG: { name: "Nigeria", city: "Lagos", lat: 6.5, lon: 3.4 },
  GH: { name: "Ghana", city: "Accra", lat: 5.6, lon: -0.2 },
  KE: { name: "Kenya", city: "Nairobi", lat: -1.3, lon: 36.8 },
  ZA: { name: "South Africa", city: "Johannesburg", lat: -26.2, lon: 28 },
  EG: { name: "Egypt", city: "Cairo", lat: 30, lon: 31.2 },
  MA: { name: "Morocco", city: "Casablanca", lat: 33.6, lon: -7.6 },
  SN: { name: "Senegal", city: "Dakar", lat: 14.7, lon: -17.4 },
  CI: { name: "Côte d'Ivoire", city: "Abidjan", lat: 5.3, lon: -4 },
  CM: { name: "Cameroon", city: "Douala", lat: 4, lon: 9.7 },
  ET: { name: "Ethiopia", city: "Addis Ababa", lat: 9, lon: 38.7 },
  TZ: { name: "Tanzania", city: "Dar es Salaam", lat: -6.8, lon: 39.3 },
  UG: { name: "Uganda", city: "Kampala", lat: 0.3, lon: 32.6 },
  RW: { name: "Rwanda", city: "Kigali", lat: -1.9, lon: 30.1 },
  GB: { name: "United Kingdom", short: "UK", city: "London", lat: 51.5, lon: -0.1 },
  IE: { name: "Ireland", city: "Dublin", lat: 53.3, lon: -6.3 },
  FR: { name: "France", city: "Paris", lat: 48.9, lon: 2.4 },
  DE: { name: "Germany", city: "Berlin", lat: 52.5, lon: 13.4 },
  ES: { name: "Spain", city: "Madrid", lat: 40.4, lon: -3.7 },
  PT: { name: "Portugal", city: "Lisbon", lat: 38.7, lon: -9.1 },
  IT: { name: "Italy", city: "Rome", lat: 41.9, lon: 12.5 },
  NL: { name: "Netherlands", city: "Amsterdam", lat: 52.4, lon: 4.9 },
  BE: { name: "Belgium", city: "Brussels", lat: 50.8, lon: 4.4 },
  SE: { name: "Sweden", city: "Stockholm", lat: 59.3, lon: 18.1 },
  NO: { name: "Norway", city: "Oslo", lat: 59.9, lon: 10.8 },
  PL: { name: "Poland", city: "Warsaw", lat: 52.2, lon: 21 },
  TR: { name: "Türkiye", city: "Istanbul", lat: 41, lon: 29 },
  RU: { name: "Russia", city: "Moscow", lat: 55.8, lon: 37.6 },
  UA: { name: "Ukraine", city: "Kyiv", lat: 50.5, lon: 30.5 },
  AE: { name: "United Arab Emirates", short: "UAE", city: "Dubai", lat: 25.2, lon: 55.3 },
  SA: { name: "Saudi Arabia", city: "Riyadh", lat: 24.7, lon: 46.7 },
  IL: { name: "Israel", city: "Tel Aviv", lat: 32.1, lon: 34.8 },
  IN: { name: "India", city: "Mumbai", lat: 19.1, lon: 72.9 },
  PK: { name: "Pakistan", city: "Karachi", lat: 24.9, lon: 67 },
  BD: { name: "Bangladesh", city: "Dhaka", lat: 23.8, lon: 90.4 },
  LK: { name: "Sri Lanka", city: "Colombo", lat: 6.9, lon: 79.9 },
  CN: { name: "China", city: "Shanghai", lat: 31.2, lon: 121.5 },
  HK: { name: "Hong Kong", city: "Hong Kong", lat: 22.3, lon: 114.2 },
  TW: { name: "Taiwan", city: "Taipei", lat: 25, lon: 121.6 },
  JP: { name: "Japan", city: "Tokyo", lat: 35.7, lon: 139.7 },
  KR: { name: "South Korea", city: "Seoul", lat: 37.6, lon: 127 },
  PH: { name: "Philippines", city: "Manila", lat: 14.6, lon: 121 },
  VN: { name: "Vietnam", city: "Ho Chi Minh City", lat: 10.8, lon: 106.7 },
  TH: { name: "Thailand", city: "Bangkok", lat: 13.8, lon: 100.5 },
  MY: { name: "Malaysia", city: "Kuala Lumpur", lat: 3.1, lon: 101.7 },
  SG: { name: "Singapore", city: "Singapore", lat: 1.35, lon: 103.8 },
  ID: { name: "Indonesia", city: "Jakarta", lat: -6.2, lon: 106.8 },
  AU: { name: "Australia", city: "Sydney", lat: -33.9, lon: 151.2 },
  NZ: { name: "New Zealand", city: "Auckland", lat: -36.8, lon: 174.8 },
  US: { name: "United States", short: "US", city: "New York", lat: 40.7, lon: -74 },
  CA: { name: "Canada", city: "Toronto", lat: 43.7, lon: -79.4 },
  MX: { name: "Mexico", city: "Mexico City", lat: 19.4, lon: -99.1 },
  JM: { name: "Jamaica", city: "Kingston", lat: 18, lon: -76.8 },
  TT: { name: "Trinidad and Tobago", city: "Port of Spain", lat: 10.7, lon: -61.5 },
  BR: { name: "Brazil", city: "São Paulo", lat: -23.6, lon: -46.6 },
  AR: { name: "Argentina", city: "Buenos Aires", lat: -34.6, lon: -58.4 },
  CO: { name: "Colombia", city: "Bogotá", lat: 4.7, lon: -74.1 },
  CL: { name: "Chile", city: "Santiago", lat: -33.4, lon: -70.7 },
  PE: { name: "Peru", city: "Lima", lat: -12, lon: -77 },
};

export const SWATCHES = ["#e3182d", "#ff8c28", "#4696ff", "#22c55e", "#8b7cf6"];

export function countryName(cc: string, short = false) {
  const c = COUNTRIES[cc];
  return c ? (short && c.short) || c.name : cc;
}
