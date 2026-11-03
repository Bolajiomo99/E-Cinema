// Shared between the executive shell and pages (client-safe).
export const ROLE_LABEL: Record<string, string> = {
  ceo: "CEO", cfo: "CFO", coo: "COO", cto: "CTO", cmo: "CMO", investor: "Investor", partner: "Partner", stakeholder: "Stakeholder",
};
export const COMMAND_ROLES = ["ceo", "cfo", "coo", "cto", "cmo"];

// The executive sidebar (Figma 49:1055). Pages not built yet carry "Soon"; locked pages need the CEO.
// "roles" lists who sees the page in their menu (the CEO sees every page); "money" adds anyone
// the CEO allowed to see money.
const CAB = ["cfo", "coo", "cto", "cmo"];
export const EXEC_NAV: { label: string; href?: string; icon: string; lock?: boolean; roles?: string[]; money?: boolean }[] = [
  { label: "Command center", href: "/executive", roles: CAB, icon: "crown", lock: true },
  { label: "Money", href: "/executive/money", roles: ["cfo"], money: true, icon: "money" },
  { label: "Growth and users", href: "/executive/growth", roles: ["cfo", "cmo", "coo"], icon: "trend" },
  { label: "Content and studios", href: "/executive/content", roles: ["coo", "cmo"], icon: "film" },
  { label: "Live operations", href: "/executive/live", roles: ["coo", "cto"], icon: "live" },
  { label: "Shop and merch", href: "/executive/shop", roles: ["coo", "cfo"], icon: "bag" },
  { label: "Rooms and VR halls", href: "/executive/rooms", roles: ["coo", "cfo"], icon: "door" },
  { label: "Safety and trust", href: "/executive/safety", roles: ["coo"], icon: "shield" },
  { label: "Hiring and jobs", href: "/executive/hiring", roles: ["coo"], icon: "case" },
  { label: "Brand protection", href: "/executive/brand", roles: ["cmo"], icon: "badge" },
  { label: "Licensing", href: "/executive/licensing", roles: ["cmo", "cfo"], icon: "tag" },
  { label: "Security operations", href: "/executive/security", roles: ["cto"], icon: "lock" },
  { label: "Infrastructure", href: "/executive/infra", roles: ["cto"], icon: "server" },
  { label: "Investor view", href: "/executive/investor", roles: ["cfo", "investor"], icon: "pie" },
  { label: "Stakeholder view", href: "/executive/stakeholder", roles: ["stakeholder"], icon: "people" },
  { label: "Partners view", href: "/executive/partners", roles: ["partner"], icon: "hands" },
  { label: "Access and roles", href: "/executive/access", icon: "key", lock: true },
  { label: "18+ recipients", icon: "heart", lock: true },
  { label: "Notifications", roles: [...CAB, "investor", "stakeholder", "partner"], icon: "bell" },
  { label: "Settings", roles: [...CAB, "investor", "stakeholder", "partner"], icon: "gear" },
];
