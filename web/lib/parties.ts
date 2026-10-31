export type PartyMember = { name: string; host: boolean; joinedAt: string };
export type Party = {
  id: string; code: string; showtimeId: string; film: string; startsAt: string; name: string;
  visibility: "link" | "invite"; rules: string[]; hostName: string; members: number;
  isHost: boolean; joined: boolean; invited?: string[]; people?: PartyMember[];
};

export const RULES: [string, string][] = [
  ["voice-notes", "Voice notes on"], ["spoiler-filter", "Spoiler filter on"], ["translate-chat", "Translate chat"], ["kids-safe", "Kids safe"],
];
export const ruleLabel = (r: string) => RULES.find(([k]) => k === r)?.[1] ?? r;
