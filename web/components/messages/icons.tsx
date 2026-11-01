import type { ReactNode } from "react";

// Stroke icons for Messages, matching the 1.8px line weight used across the designs.
const I = (d: ReactNode, size = 22) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
export const IconPen = () => I(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>, 18);
export const IconSearch = () => I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></>, 16);
export const IconPhone = () => I(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />);
export const IconVideo = () => I(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>);
export const IconMore = () => I(<><circle cx="12" cy="5.5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="18.5" r="1" /></>);
export const IconPlus = () => I(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>);
export const IconImage = () => I(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>);
export const IconTicket = () => I(<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" />);
export const IconSmile = () => I(<><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.01M15 9.5v.01" /></>);
export const IconMic = () => I(<><rect x="9" y="2.5" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" /></>, 20);
export const IconSend = () => I(<path d="M4 12 20 4l-6 16-3-7z" />, 20);
export const IconPlay = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><path d="M7 5v14l12-7z" /></svg>;
export const IconPause = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
export const IconLock = () => I(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, 12);
export const IconBack = () => I(<path d="m15 5-7 7 7 7" />);
export const IconClose = () => I(<path d="M6 6l12 12M18 6 6 18" />, 18);
export const IconTrash = () => I(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, 18);
