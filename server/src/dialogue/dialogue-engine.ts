import type { DialogueTreeData, DialogueNodeData, ChoiceOptionData } from "@town-zero/shared";
import { interpolate, checkCondition, type EvalContext } from "./evaluator.js";
import { executeEffects, type MutableContext } from "./executor.js";

export class DialogueEngine {
  private tree: DialogueTreeData;
  private currentNodeId: string;
  private visitedNodes: string[] = [];
  private selectedOptions: Record<string, string> = {};

  constructor(tree: DialogueTreeData) {
    this.tree = tree;
    this.currentNodeId = tree.root;
    this.visitedNodes.push(tree.root);
  }

  getTreeId(): string {
    return this.tree.id;
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

  getVisitedNodes(): string[] {
    return this.visitedNodes;
  }

  getSelectedOptions(): Record<string, string> {
    return this.selectedOptions;
  }

  /** Get interpolated text content for the current text node. */
  getInterpolatedContent(ctx: EvalContext): string {
    const node = this.getCurrentNode();
    if (node.type === "text") {
      return interpolate(node.content, ctx);
    }
    return "";
  }

  /** Get visible options for the current choice node, filtered by condition evaluation. */
  getVisibleOptions(ctx: EvalContext): ChoiceOptionData[] {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return [];
    return node.options.filter((opt) => {
      if (!opt.condition) return true;
      return checkCondition(opt.condition, ctx);
    });
  }

  /** Advance past a text node to the next node. */
  advance(): void {
    const node = this.getCurrentNode();
    if (node.type === "text") {
      this.moveTo(node.next);
    } else if (node.type === "action") {
      // Action nodes advance without executing effects here —
      // effects are executed via advanceWithEffects()
      this.moveTo(node.next);
    }
  }

  /** Advance past an action node, executing its effects. */
  advanceWithEffects(ctx: MutableContext): void {
    const node = this.getCurrentNode();
    if (node.type === "action") {
      executeEffects(node.effects, ctx);
      this.moveTo(node.next);
    } else {
      this.advance();
    }
  }

  /** Select a choice option by its id. */
  selectOptionById(optionId: string): void {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return;
    const option = node.options.find((o) => o.id === optionId);
    if (option) {
      this.selectedOptions[this.currentNodeId] = optionId;
      this.moveTo(option.next);
    }
  }

  /** Select a choice option by index (backwards compat). */
  selectOption(index: number): void {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return;
    const option = node.options[index];
    if (option) {
      this.selectedOptions[this.currentNodeId] = option.id;
      this.moveTo(option.next);
    }
  }

  resolveRequest(accepted: boolean): void {
    const node = this.getCurrentNode();
    if (node.type !== "request") return;
    this.moveTo(accepted ? node.nextYes : node.nextNo);
  }

  private moveTo(nodeId: string): void {
    this.currentNodeId = nodeId;
    this.visitedNodes.push(nodeId);
  }
}
