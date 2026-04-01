import type { DialogueTree, DialogueNode, DialogueNodeId } from "@town-zero/shared";

export class DialogueEngine {
  private tree: DialogueTree;
  private currentNodeId: DialogueNodeId;
  private locals: Map<string, unknown> = new Map();

  constructor(tree: DialogueTree) {
    this.tree = tree;
    this.currentNodeId = tree.root;
    if (tree.defaultLocals) {
      for (const [k, v] of Object.entries(tree.defaultLocals)) {
        this.locals.set(k, v);
      }
    }
  }

  getCurrentNode(): DialogueNode {
    const node = this.tree.nodes[this.currentNodeId];
    if (!node) throw new Error(`Dialogue node "${this.currentNodeId}" not found in tree "${this.tree.id}"`);
    return node;
  }

  getCurrentNodeId(): DialogueNodeId {
    return this.currentNodeId;
  }

  isEnded(): boolean {
    return this.getCurrentNode().type === "end";
  }

  advance(): void {
    const node = this.getCurrentNode();
    if (node.type === "text") {
      this.currentNodeId = node.next;
    } else if (node.type === "action") {
      this.currentNodeId = node.next;
    }
  }

  selectOption(index: number): void {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return;
    const option = node.options[index];
    if (option) {
      this.currentNodeId = option.next;
    }
  }

  resolveRequest(accepted: boolean): void {
    const node = this.getCurrentNode();
    if (node.type !== "request") return;
    this.currentNodeId = accepted ? node.nextYes : node.nextNo;
  }

  getLocal(key: string): unknown {
    return this.locals.get(key);
  }

  setLocal(key: string, value: unknown): void {
    this.locals.set(key, value);
  }
}
