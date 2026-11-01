// Careers board shapes shared by pages and the browser (Figma 94:1157, 114:1273, 114:1397, 114:1531).
export type Job = {
  slug: string; title: string; team: string; city: string; country: string; remote: boolean;
  kind: "full" | "part" | "intern" | "shift"; quota: "ng" | "world"; pay: string; setup: string;
  about: string; bring: string; open: boolean; createdAt: string; applied?: number;
};
export type Board = { jobs: Job[]; total: number; nigeria: number; world: number; ngShare: number; teams: string[] | null; kinds: Record<string, number> };
export type Event = { stage: string; at: string; detail: string };
export type Application = {
  id: string; job: Job; name: string; email: string; country: string; link: string; cvKey?: string; why: string; keep: boolean; ngEligible: boolean;
  stage: Stage; message: string; taskDue?: string; taskPay: string; interviewAt?: string; interviewWith: string;
  createdAt: string; updatedAt: string; events: Event[] | null;
};
export type Stage = "received" | "chat" | "task" | "team" | "offer" | "hired" | "closed";
export type Quote = { id: string; organisation: string; email: string; guests: number; country: string; kind: string; note: string; status: string; createdAt: string };

export const KIND: Record<Job["kind"], string> = { full: "Full time", part: "Part time", intern: "Internship", shift: "Shift work" };
export const STAGES: [Stage, string][] = [["received", "Application received"], ["chat", "Chat with a recruiter"], ["task", "Paid take-home task"], ["team", "Meet the team"], ["offer", "Offer"]];

export function where(j: Job, countryName: (cc: string) => string) {
  return j.remote ? (j.city.toLowerCase() === "remote" ? "Remote, any country" : `${j.city} or remote`) : `${j.city}, ${countryName(j.country)}`;
}
