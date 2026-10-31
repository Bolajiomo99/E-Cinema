import { redirect } from "next/navigation";

// Devices moved into Settings · Security and devices (Figma 33:781).
export default function DevicesPage() {
  redirect("/settings/security");
}
