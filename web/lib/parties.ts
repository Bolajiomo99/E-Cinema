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

// Room types published on the executive "Rooms and VR halls" page.
export type RoomOption = { id: string; name: string; kind: "vr" | "ar" | "party" | "private"; scene: string; seats: number; audience: string; voice: boolean; spatial: boolean; avatars: boolean };
