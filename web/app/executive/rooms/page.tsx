import { session } from "@/lib/licensing";
import { execRooms } from "@/lib/exec";
import ExecRooms from "@/components/exec/ExecRooms";

export const metadata = { title: "Rooms and VR halls · Executive · E-Cinema", robots: { index: false } };

// Rooms and VR halls (Figma 83:831).
export default async function Rooms() {
  const d = await execRooms(await session());
  if (!d) return <section className="exc"><h1>Rooms and VR halls</h1><p className="exc-sub">This page is for the CEO, the COO and the CFO.</p></section>;
  return <ExecRooms d={d} />;
}
