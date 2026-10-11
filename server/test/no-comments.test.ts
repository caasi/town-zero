import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const allowedFile = "comments-allowed.txt";

function sourceFiles(): string[] {
  return execFileSync("git", ["-C", root, "ls-files", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function commentKeys(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const starts = new Map<number, number>();
  const add = (ranges: ts.CommentRange[] | undefined) => ranges?.forEach((r) => starts.set(r.pos, r.end));
  const walk = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(source).forEach(walk);
  };
  walk(source);
  return [...starts].map(([pos, end]) => `${file}\t${text.slice(pos, end).split("\n")[0].trim()}`);
}

function allowed(): string[] {
  return readFileSync(`${root}/${allowedFile}`, "utf8").split("\n").filter((line) => line.includes("\t"));
}

describe("comments", () => {
  const found = sourceFiles().flatMap((file) => commentKeys(file, readFileSync(`${root}/${file}`, "utf8")));
  const allowList = allowed();

  it("adds no comment outside the keep-list (CLAUDE.md, Comments)", () => {
    const extra = found.filter((key) => !allowList.includes(key));
    expect(extra, `Delete these comments, or add them to ${allowedFile} if a keep-list rule in CLAUDE.md applies`).toEqual([]);
  });

  it("keeps no entry for a comment that is gone", () => {
    const stale = allowList.filter((key) => !found.includes(key));
    expect(stale, `Remove these lines from ${allowedFile}`).toEqual([]);
  });

  it("sees a new comment", () => {
    expect(commentKeys("a.ts", "const a = 1; // why\n")).toEqual(["a.ts\t// why"]);
  });
});
