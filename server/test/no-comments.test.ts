import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const keepPrefix = /^\/\/ (external|issue|license): /;
const directive = /^\/\/\/\s*<reference |^\/\/\s*prettier-ignore\b/;
const typeTestDirective = /^\/\/\s*@ts-expect-error\b/;

function sourceFiles(): string[] {
  return execFileSync("git", ["-C", root, "ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

type Comment = { line: number; text: string; ownLine: boolean };

function comments(file: string, text: string): Comment[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, ts.CommentRange>();
  const add = (found: ts.CommentRange[] | undefined) => found?.forEach((r) => ranges.set(r.pos, r));
  const walk = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(source).forEach(walk);
  };
  walk(source);
  return [...ranges.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((r) => {
      const { line, character } = source.getLineAndCharacterOfPosition(r.pos);
      const before = text.slice(r.pos - character, r.pos);
      return {
        line,
        text: text.slice(r.pos, r.end),
        ownLine: r.kind === ts.SyntaxKind.SingleLineCommentTrivia && before.trim() === "",
      };
    });
}

function isDirective(file: string, comment: string): boolean {
  return directive.test(comment) || (file.startsWith("shared/type-tests/") && typeTestDirective.test(comment));
}

function refused(file: string, text: string): string[] {
  const bad: string[] = [];
  let last: { comment: Comment; kept: boolean } | undefined;
  for (const c of comments(file, text)) {
    const continuesKept =
      c.ownLine && last?.kept === true && last.comment.ownLine && c.line === last.comment.line + 1 && !isDirective(file, last.comment.text);
    const kept = (c.ownLine && keepPrefix.test(c.text)) || continuesKept;
    if (!kept && !isDirective(file, c.text)) bad.push(`${file}:${c.line + 1}: ${c.text.split("\n")[0]}`);
    last = { comment: c, kept: kept || isDirective(file, c.text) };
  }
  return bad;
}

describe("comments", () => {
  it("has no comment without a keep prefix (CLAUDE.md, Comments)", () => {
    const bad = sourceFiles().flatMap((file) => refused(file, readFileSync(`${root}/${file}`, "utf8")));
    expect(bad, "Delete these comments, or start them with external:, issue: or license: if that item of the keep-list in CLAUDE.md applies").toEqual([]);
  });

  it("allows the next lines of a kept comment", () => {
    expect(refused("a.ts", "// external: one\n// two\nconst a = 1;\n")).toEqual([]);
  });

  it("refuses a comment after a blank line, at the end of a code line, or after a directive", () => {
    expect(refused("a.ts", "// external: one\n\n// two\n")).toEqual(["a.ts:3: // two"]);
    expect(refused("a.ts", "// external: one\nconst a = 1; // two\n")).toEqual(["a.ts:2: // two"]);
    expect(refused("a.ts", "// prettier-ignore\n// two\n")).toEqual(["a.ts:2: // two"]);
  });

  it("allows the prefix only on an own-line // comment", () => {
    expect(refused("a.ts", "/** external: one */\n")).toEqual(["a.ts:1: /** external: one */"]);
    expect(refused("a.ts", "const a = 1; // external: one\n")).toEqual(["a.ts:1: // external: one"]);
  });

  it("allows @ts-expect-error only in the type tests", () => {
    expect(refused("shared/type-tests/a.ts", "// @ts-expect-error - wrong key\n")).toEqual([]);
    expect(refused("server/src/a.ts", "// @ts-expect-error\n")).toEqual(["server/src/a.ts:1: // @ts-expect-error"]);
  });
});
