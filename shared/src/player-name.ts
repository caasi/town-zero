import { PLAYER_NAME_MAX, PLAYER_NAME_MAX_MARKS, PLAYER_NAME_MAX_UNITS } from "./constants.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function normalizePlayerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw
    .replace(/(?!\u200D)\p{Cf}/gu, "")
    .replace(/[\p{Cc}\u2028\u2029\s\u115F\u1160\u2800\u3164\uFFA0]+/gu, " ")
    .trim();
  let name = "";
  let count = 0;
  for (const { segment } of segmenter.segment(clean)) {
    let marks = 0;
    const char = Array.from(segment).filter((c) => !/\p{M}/u.test(c) || ++marks <= PLAYER_NAME_MAX_MARKS).join("");
    if (count === PLAYER_NAME_MAX || name.length + char.length > PLAYER_NAME_MAX_UNITS) break;
    name += char;
    count++;
  }
  name = name.trim();
  return /[^\p{M}\p{Z}\u200D]/u.test(name) ? name : null;
}

export function playerNameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\u200D/g, "");
}

export function uniquePlayerName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name;
  const chars = Array.from(segmenter.segment(name), (s) => s.segment);
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = chars.slice(0, PLAYER_NAME_MAX - suffix.length).join("").trim() + suffix;
    if (!taken(candidate)) return candidate;
  }
}

export const PLAYER_COLORS = ["#e6c", "#f93", "#ee5", "#b8f", "#4db", "#fa8"] as const;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function playerColor(name: string): string {
  return PLAYER_COLORS[fnv1a(name) % PLAYER_COLORS.length];
}

export const NAME_ADJECTIVES = [
  "Quiet", "Solid", "Liquid", "Silent", "Swift", "Iron", "Grey", "Wild",
  "Lone", "Crimson", "Old", "Little", "Bold", "Sly", "Calm", "Dusty",
  "Frost", "Ember", "Stone", "Shadow", "Rapid", "Sharp", "Hidden", "Pale",
  "Brave", "Lucky", "Rusty", "Steel", "Night", "Gentle",
] as const;

export const NAME_ANIMALS = [
  "Otter", "Heron", "Fox", "Wolf", "Raven", "Owl", "Lynx", "Badger",
  "Hare", "Boar", "Crane", "Falcon", "Viper", "Mantis", "Ocelot", "Bear",
  "Stag", "Moth", "Crow", "Eel", "Toad", "Hawk", "Mole", "Ferret",
  "Marten", "Beetle", "Gecko", "Cobra", "Wren", "Bison",
] as const;

export function randomPlayerName(rand: () => number = Math.random): string {
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  return `${pick(NAME_ADJECTIVES)} ${pick(NAME_ANIMALS)}`;
}
