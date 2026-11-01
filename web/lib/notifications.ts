import "server-only";
import { accountApi } from "@/lib/auth";

// The viewer's notifications from api/internal/notify (Figma 31:878).
export type Note = { id: number; kind: string; title: string; body: string; link: string; createdAt: string; readAt: string | null };
export type Category = "all" | "premieres" | "social" | "payments";

export async function myNotifications(session: string, category: Category): Promise<{ notifications: Note[]; unread: number } | null> {
  const r = await accountApi("GET", `/v1/me/notifications?category=${category === "all" ? "" : category}`, undefined, session);
  return r.status === 200 ? (r.body as { notifications: Note[]; unread: number }) : null;
}
