// Shared between the executive shell and pages (client-safe).
export const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO", cfo: "CFO", coo: "COO", cto: "CTO", cmo: "CMO", investor: "Investor", partner: "Partner", stakeholder: "Stakeholder",
};
export const COMMAND_ROLES = ["ceo", "cfo", "coo", "cto", "cmo"];

// The executive sidebar (Figma 49:1055). Pages not built yet carry "Soon"; locked pages need the CEO.
export const EXEC_NAV: { label: string; href?: string; icon: string; lock?: boolean }[] = [
  { label: "Command center", href: "/executive", icon: "crown", lock: true },
  { label: "Money", icon: "money" },
  { label: "Growth and users", icon: "trend" },
  { label: "Content and studios", icon: "film" },
  { label: "Live operations", icon: "live" },
  { label: "Shop and merch", icon: "bag" },
  { label: "Rooms and VR halls", icon: "door" },
  { label: "Safety and trust", icon: "shield" },
  { label: "Hiring and jobs", icon: "case" },
  { label: "Brand protection", icon: "badge" },
  { label: "Licensing", icon: "tag" },
  { label: "Security operations", icon: "lock" },
  { label: "Infrastructure", icon: "server" },
  { label: "Investor view", icon: "pie" },
  { label: "Stakeholder view", icon: "people" },
  { label: "Partners view", icon: "hands" },
  { label: "Access and roles", icon: "key", lock: true },
  { label: "18+ recipients", icon: "heart", lock: true },
  { label: "Notifications", icon: "bell" },
  { label: "Settings", icon: "gear" },
];
