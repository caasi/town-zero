import type { Gender } from "@town-zero/shared";

// Jev reads state as words, never as codes (spec 003).
export function describeGender(name: string, gender: Gender): string {
  switch (gender.kind) {
    case "male": return `${name} is a man.`;
    case "female": return `${name} is a woman.`;
    case "nonbinary": return `${name} is neither a man nor a woman.`;
    case "other": return `${name} is ${gender.description}.`;
  }
}
