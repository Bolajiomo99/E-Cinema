export type Classic = { id: string; title: string; year?: number; fromVault: boolean; goal: number; requests: number; colors: string[]; showtimeId?: string; mine: boolean };
export const CAN_REQUEST = new Set(["pro", "enterprise"]);
