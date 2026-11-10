// Browsers print African zones as "GMT+1" or "GMT+3". Viewers there know them as WAT, CAT,
// EAT or SAST, which is also what the designs show, so swap in the local name.
const NAMES: Record<string, string> = {
  "Africa/Lagos": "WAT", "Africa/Douala": "WAT", "Africa/Kinshasa": "WAT", "Africa/Luanda": "WAT", "Africa/Niamey": "WAT", "Africa/Porto-Novo": "WAT", "Africa/Ndjamena": "WAT", "Africa/Libreville": "WAT", "Africa/Malabo": "WAT", "Africa/Brazzaville": "WAT", "Africa/Bangui": "WAT",
  "Africa/Nairobi": "EAT", "Africa/Addis_Ababa": "EAT", "Africa/Dar_es_Salaam": "EAT", "Africa/Kampala": "EAT", "Africa/Mogadishu": "EAT", "Africa/Djibouti": "EAT", "Africa/Asmara": "EAT",
  "Africa/Johannesburg": "SAST", "Africa/Maseru": "SAST", "Africa/Mbabane": "SAST",
  "Africa/Harare": "CAT", "Africa/Lusaka": "CAT", "Africa/Maputo": "CAT", "Africa/Gaborone": "CAT", "Africa/Blantyre": "CAT", "Africa/Kigali": "CAT", "Africa/Bujumbura": "CAT", "Africa/Lubumbashi": "CAT", "Africa/Windhoek": "CAT", "Africa/Juba": "CAT", "Africa/Khartoum": "CAT",
};

export function localZoneName(text: string, timeZone?: string) {
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = NAMES[tz];
  return name ? text.replace(/GMT[+-]\d{1,2}(:\d{2})?|UTC[+-]\d{1,2}/, name) : text;
}
