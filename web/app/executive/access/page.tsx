import { session } from "@/lib/licensing";
import { execPeople } from "@/lib/exec";
import ExecAccess from "@/components/exec/ExecAccess";

export const metadata = { title: "Access and roles · Executive · E-Cinema", robots: { index: false } };

function nowMs() {
  return Date.now();
}

// Access and roles (Figma 49:1307 and the grant dialog 99:1041). Only the CEO gets the list.
export default async function Access() {
  const people = await execPeople(await session());
  if (!people) {
    return <section className="exc"><h1>Access and roles</h1><p className="exc-sub">Only the CEO can grant, change or remove access.</p></section>;
  }
  return <ExecAccess initial={people} now={nowMs()} />;
}
