// Shapes shared by the Messages page and its API proxy (api/internal/chat).
export type Person = { id: string; name: string; country: string; languages: string[]; friend: boolean; requested?: boolean; online: boolean };
export type Party = { code: string; name: string; film: string; showtimeId: string; startsAt: string };
export type Message = {
  id: number; conversationId: string; senderId: string; senderName: string; kind: "text" | "voice" | "photo" | "party";
  body: string; mediaKey?: string; durationMs?: number; transcript?: string; party?: Party; createdAt: string;
};
export type Conversation = {
  id: string; kind: "dm" | "group"; name: string; otherId?: string; members: number; last: Message | null;
  lastAt: string; unread: number; online: boolean; role: string; translate: boolean;
};
export type Thread = { conversation: Conversation; messages: Message[]; readBy: Record<string, number>; members: Person[]; more: boolean };
export type FriendRequest = { id: string; from: Person; note: string; spam: "" | "ai" | "rules"; room: string; mutual: number; createdAt: string };
export type ChatEvent =
  | { type: "hello"; online?: string[] }
  | { type: "msg"; conversationId: string; message: Message }
  | { type: "read"; conversationId: string; accountId: string; upto: number }
  | { type: "presence"; accountId: string; on?: boolean }
  | { type: "typing"; conversationId: string; accountId: string }
  | { type: "request"; accountId: string };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? "")).toUpperCase();
}

// A steady colour per person, from the avatar palette in the designs.
const COLORS = ["#16a34a", "#0ea5e9", "#e3182d", "#9333ea", "#0891b2", "#f5b841", "#3b82f6", "#db2777", "#ea580c", "#2f6fed"];
export function avatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function preview(m: Message | null, me: string, group: boolean): string {
  if (!m) return "No messages yet";
  const who = group && m.senderId !== me ? `${m.senderName.split(" ")[0]}: ` : m.senderId === me ? "You: " : "";
  if (m.kind === "voice") {
    const s = Math.round((m.durationMs ?? 0) / 1000);
    return `${who}🎙 Voice note · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  if (m.kind === "photo") return `${who}📷 ${m.body || "Photo"}`;
  if (m.kind === "party") return `${who}🎟 ${m.party ? `${m.party.film} watch party` : "Watch party"}`;
  return who + m.body;
}
