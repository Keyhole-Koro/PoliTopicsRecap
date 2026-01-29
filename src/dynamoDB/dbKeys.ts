import { yOf, mOf } from "./dateUtils";

// ==========================
// Key helpers
// ==========================
export const artPK = (id: string) => `A#${id}`;
export const artSK = "META";

// Consider normalizing PERSON/KEYWORD via yomi/slug in production
export const catKey = (c: string) => `CATEGORY#${c}`;
export const personKey = (p: string) => `PERSON#${p}`;
export const kwKey = (k: string) => `KEYWORD#${k}`;
export const kindKey = (k: string) => `IMAGEKIND#${k}`;
export const sessionKey = (s: number | string) => `SESSION#${String(s).padStart(4, "0")}`;
export const houseKey = (h: string) => `HOUSE#${h}`;
export const meetingKey = (m: string) => `MEETING#${m}`;

// Compose thin-index SK as "Y#YYYY#M#MM#D#<YYYY-MM-DD>#A#<id>"
export const idxSK = (monthYYYYMM: string, isoDate: string, id: string) =>
  `Y#${yOf(monthYYYYMM)}#M#${mOf(monthYYYYMM)}#D#${isoDate}#A#${id}`;
