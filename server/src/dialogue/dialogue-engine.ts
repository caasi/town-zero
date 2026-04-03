import type { DialogueTreeData, DialogueNodeData } from "@town-zero/shared";

export class DialogueEngine {
  private tree: DialogueTreeData;
  private currentNodeId: string;

  constructor(tree: DialogueTreeData) {
    this.tree = tree;
    this.currentNodeId = tree.root;
  }

  getCurrentNode(): DialogueNodeData {
    const node = this.tree.nodes[this.currentNodeId];
    if (!node) throw new Error(`Dialogue node "${this.currentNodeId}" not found in tree "${this.tree.id}"`);
    return node;
  }

  getCurrentNodeId(): string {
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
}
