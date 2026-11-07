import { session } from "@/lib/licensing";
import { commandCenter } from "@/lib/exec";
import { COMMAND_ROLES } from "@/lib/exec-types";
import ExecCommand from "@/components/exec/ExecCommand";
import { uptime } from "@/lib/uptime";

export const metadata = { title: "Command center · Executive · E-Cinema", robots: { index: false } };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lagosNow() {
  return new Date(Date.now() + 3600_000);
}

// The CEO command center (Figma 49:1055), with the date and greeting in Lagos time.
export default async function CommandCenter() {
  const p = await commandCenter(await session());
  if (!p || !COMMAND_ROLES.includes(p.command.role)) {
    return <section className="exc"><h1>Command center</h1><p className="exc-sub">This page is for the CEO and the operating officers. Your pages are in the menu.</p></section>;
  }
  const l = lagosNow();
  const h = l.getUTCHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const when = `${DAYS[l.getUTCDay()]} ${l.getUTCDate()} ${MONTHS[l.getUTCMonth()]} ${l.getUTCFullYear()} · ${String(h).padStart(2, "0")}:${String(l.getUTCMinutes()).padStart(2, "0")} WAT`;
  const weekday = DAYS[l.getUTCDay()];
  return <ExecCommand up={await uptime()} page={p} hello={`${hello}, ${p.command.name.trim().split(/\s+/)[0] || "there"}`} when={when} weekday={weekday} />;
}
