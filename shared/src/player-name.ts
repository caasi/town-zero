// Player names: one rule for the client and the server, so a name the client
// shows is the name the server keeps.

import { PLAYER_NAME_MAX, PLAYER_NAME_MAX_MARKS, PLAYER_NAME_MAX_UNITS } from "./constants.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The name to keep, or null when nothing visible is left. Client input is
 * untrusted, and every client draws the name:
 * - control and format characters go (bidi overrides could reverse other
 *   text, a zero-width space hides a name), except ZWJ, which joins emoji;
 * - white space folds to one space;
 * - at most PLAYER_NAME_MAX characters as a person sees them, never cut
 *   inside one; each keeps at most PLAYER_NAME_MAX_MARKS combining marks, as
 *   one character could stack thousands of them (Zalgo text);
 * - at most PLAYER_NAME_MAX_UNITS UTF-16 units in all.
 */
export function normalizePlayerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw
    .replace(/(?!\u200D)\p{Cf}/gu, "")              // format characters: gone
    // Controls, line breaks, white space, and letters that draw as nothing
    // (Hangul fillers, the blank Braille pattern): one space.
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

// Not the blue of yourself, the green of friendly NPCs or the red of enemies
// (client/src/renderer.ts). A name always gets the same color: the color is a
// hash of the name, so every client draws a player the same way.
export const PLAYER_COLORS = ["#e6c", "#f93", "#ee5", "#b8f", "#4db", "#fa8"] as const;

/** FNV-1a (32 bit) over UTF-16 code units: small, fixed, the same on every client. */
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

// The default name on a first visit: an adjective and an animal, our own lists.
// Every combination fits PLAYER_NAME_MAX.
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
