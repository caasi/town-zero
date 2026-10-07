import type { DialogueTreeData, DialogueNodeData, ChoiceOptionData, ReplyLineData } from "@town-zero/shared";
import { interpolate, checkCondition, type EvalContext } from "./evaluator.js";
import { executeEffects, type MutableContext } from "./executor.js";

export class DialogueEngine {
  private tree: DialogueTreeData;
  private currentNodeId: string;
  private visitedNodes: string[] = [];
  private selectedOptions: Record<string, string> = {};
  // Reply node state; moveTo() clears both.
  private pickedLineId: string | null = null;
  private replyAsked = false;

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

  /** Get all options for the current choice node with enabled status. */
  getAllOptionsWithStatus(ctx: EvalContext): Array<ChoiceOptionData & { enabled: boolean }> {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return [];
    return node.options.map((opt) => ({
      ...opt,
      enabled: !opt.condition || checkCondition(opt.condition, ctx),
    }));
  }

  /** Lines of the current reply node: the first always, the others when their condition holds. */
  getVisibleReplyLines(ctx: EvalContext): ReplyLineData[] {
    const node = this.getCurrentNode();
    if (node.type !== "reply") return [];
    const [first, ...rest] = node.lines;
    return [first, ...rest.filter((line) => !line.condition || checkCondition(line.condition, ctx))];
  }

  getPickedLine(): ReplyLineData | null {
    const node = this.getCurrentNode();
    if (node.type !== "reply" || this.pickedLineId === null) return null;
    return node.lines.find((line) => line.id === this.pickedLineId) ?? null;
  }

  pickLine(lineId: string): void {
    this.pickedLineId = lineId;
    this.selectedOptions[this.currentNodeId] = lineId;
  }

  isReplyAsked(): boolean {
    return this.replyAsked;
  }

  markReplyAsked(): void {
    this.replyAsked = true;
  }

  /** Advance past a text or action node, or a reply node whose line is picked. For action nodes, effects are NOT executed — use advanceWithEffects() instead. */
  advance(): void {
    const node = this.getCurrentNode();
    const picked = this.getPickedLine();
    if (node.type === "text" || node.type === "action") {
      this.moveTo(node.next);
    } else if (picked) {
      this.moveTo(picked.next);
    } else {
      throw new Error(`advance() called on "${node.type}" node "${this.currentNodeId}" — expected text or action`);
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
    if (node.type !== "choice") {
      throw new Error(`selectOptionById() called on "${node.type}" node "${this.currentNodeId}" — expected choice`);
    }
    const option = node.options.find((o) => o.id === optionId);
    if (!option) {
      const available = node.options.map((o) => o.id).join(", ");
      throw new Error(`Option "${optionId}" not found in choice node "${this.currentNodeId}". Available: ${available}`);
    }
    this.selectedOptions[this.currentNodeId] = optionId;
    this.moveTo(option.next);
  }

  /** Select a choice option by its position index. Prefer selectOptionById() for explicit selection. */
  selectOption(index: number): void {
    const node = this.getCurrentNode();
    if (node.type !== "choice") {
      throw new Error(`selectOption() called on "${node.type}" node "${this.currentNodeId}" — expected choice`);
    }
    const option = node.options[index];
    if (!option) {
      throw new Error(`Option index ${index} out of range in choice node "${this.currentNodeId}" (${node.options.length} options)`);
    }
    this.selectedOptions[this.currentNodeId] = option.id;
    this.moveTo(option.next);
  }

  private moveTo(nodeId: string): void {
    this.pickedLineId = null;
    this.replyAsked = false;
    this.currentNodeId = nodeId;
    this.visitedNodes.push(nodeId);
  }
}
