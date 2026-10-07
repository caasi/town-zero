import type { DialogueTreeData, Value, ResourceType, FarewellLine, ReplyLineData } from "@town-zero/shared";
import { DialogueEngine } from "./dialogue-engine.js";
import { interpolate, checkCondition, type EvalContext, type AgentAccessor } from "./evaluator.js";
import type { MutableContext } from "./executor.js";
import type { Agent } from "../simulation/agent.js";

export interface DialogueStateMessage {
  treeId: string;
  nodeId: string;
  type: "text" | "choice" | "waiting" | "end";
  speaker: string;
  text: string;
  options?: Array<{ id: string; label: string }>;
}

/** What Jev needs to pick a reply line. Words only (spec 003). */
export interface ReplyRequest {
  /** Pass it back to answerReply: an answer counts only for the request it belongs to. */
  token: number;
  /** "<tree id>/<node id>": with the state words, the key of a cached pick. */
  nodeKey: string;
  playerLine: string | null;
  lines: Array<{ id: string; description: string }>;
}

export class DialogueSession {
  private engine: DialogueEngine;
  private _npc: Agent;
  private _player: Agent;
  private currentTick: number;
  private locals: Map<string, Value> = new Map();
  private disposed = false;
  // The option text the player chose last: what the NPC replies to.
  private lastPlayerLine: string | null = null;
  // The open request for Jev: the lines it was offered, under a new token per
  // request, so a late answer cannot land on a later visit of the node.
  private replyRequest: { token: number; lines: ReplyLineData[] } | null = null;
  private nextReplyToken = 1;

  // Timeout tracking
  startTick: number;
  lastInteractionTick: number;

  constructor(opts: {
    tree: DialogueTreeData;
    npc: Agent;
    player: Agent;
    currentTick: number;
  }) {
    this.engine = new DialogueEngine(opts.tree);
    this._npc = opts.npc;
    this._player = opts.player;
    this.currentTick = opts.currentTick;
    this.startTick = opts.currentTick;
    this.lastInteractionTick = opts.currentTick;

    // Load existing dialogue progress locals
    const progress = opts.npc.getDialogueProgress(opts.tree.id);
    if (progress) {
      for (const [k, v] of Object.entries(progress.locals)) {
        this.locals.set(k, v);
      }
    }
  }

  get npcId(): string { return this._npc.id; }
  get playerId(): string { return this._player.id; }

  updateTick(tick: number): void {
    this.lastInteractionTick = tick;
    this.currentTick = tick;
  }

  isEnded(): boolean {
    return this.engine.isEnded();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Release agent locks and persist progress. Idempotent — safe to call
   * multiple times or from any cleanup path.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Persist dialogue progress on NPC
    const localsObj: Record<string, Value> = {};
    for (const [k, v] of this.locals) {
      localsObj[k] = v;
    }
    this._npc.setDialogueProgress(this.engine.getTreeId(), {
      visitedNodes: this.engine.getVisitedNodes(),
      selectedOptions: this.engine.getSelectedOptions(),
      locals: localsObj,
    });

    // Release locks on both agents
    this._npc.currentTalkingTo = null;
    this._player.talkingToNpcId = null;
  }

  /** Get the current state as a pre-rendered message for the client.
   *  Auto-advances through action nodes (executing effects) until a visible node is reached. */
  getState(depth = 0): DialogueStateMessage {
    const node = this.engine.getCurrentNode();
    const ctx = this.buildEvalContext();
    const nodeId = this.engine.getCurrentNodeId();
    const treeId = this.engine.getTreeId();

    switch (node.type) {
      case "text":
        return {
          treeId,
          nodeId,
          type: "text",
          speaker: node.speaker,
          text: interpolate(node.content, ctx),
        };

      case "choice": {
        const visible = this.engine.getVisibleOptions(ctx);
        return {
          treeId,
          nodeId,
          type: "choice",
          speaker: "npc",
          text: "",
          options: visible.map((opt) => ({
            id: opt.id,
            label: interpolate(opt.label, ctx),
          })),
        };
      }

      case "reply": {
        let picked = this.engine.getPickedLine();
        const lines = this.engine.getVisibleReplyLines(ctx);
        // One line left: nothing to choose, so no Jev call.
        if (!picked && lines.length === 1) {
          this.engine.pickLine(lines[0].id);
          picked = lines[0];
        }
        if (!picked) {
          return { treeId, nodeId, type: "waiting", speaker: "npc", text: "…" };
        }
        return { treeId, nodeId, type: "text", speaker: "npc", text: interpolate(picked.text, ctx) };
      }

      case "action":
        // Auto-advance through action nodes, executing effects
        if (depth >= 100) {
          throw new Error(`Dialogue "${treeId}" exceeded maximum action chain depth at node "${nodeId}" — possible cycle in action nodes`);
        }
        this.engine.advanceWithEffects(this.buildMutableContext());
        return this.getState(depth + 1);

      case "end":
        return {
          treeId,
          nodeId,
          type: "end",
          speaker: "",
          text: "",
        };
    }
  }

  /** The first farewell whose condition holds, in this dialogue's context. */
  farewell(lines: FarewellLine[]): string | null {
    const ctx = this.buildEvalContext();
    const line = lines.find((l) => !l.condition || checkCondition(l.condition, ctx));
    return line ? interpolate(line.text, ctx) : null;
  }

  /** True while the NPC waits for Jev to pick its reply line. */
  isWaiting(): boolean {
    const node = this.engine.getCurrentNode();
    if (node.type !== "reply" || this.engine.getPickedLine()) return false;
    return this.engine.getVisibleReplyLines(this.buildEvalContext()).length > 1;
  }

  /** The request for Jev, once per visit of a reply node; null when no call is needed. */
  takeReplyRequest(): ReplyRequest | null {
    if (!this.isWaiting() || this.engine.isReplyAsked()) return null;
    this.engine.markReplyAsked();
    const lines = this.engine.getVisibleReplyLines(this.buildEvalContext());
    this.replyRequest = { token: this.nextReplyToken++, lines };
    return {
      token: this.replyRequest.token,
      nodeKey: `${this.engine.getTreeId()}/${this.engine.getCurrentNodeId()}`,
      playerLine: this.lastPlayerLine,
      lines: lines.map((line) => ({ id: line.id, description: line.description })),
    };
  }

  /**
   * Jev's pick for request `token`. False when it is too late: the session
   * ended, moved on, or asked again. The pick is checked against the lines
   * that request offered (conditions may have changed since); an id it did
   * not offer falls back to the first line.
   */
  answerReply(token: number, lineId: string): boolean {
    const request = this.replyRequest;
    if (this.disposed || !this.isWaiting() || request?.token !== token) return false;
    this.replyRequest = null;
    this.engine.pickLine((request.lines.find((line) => line.id === lineId) ?? request.lines[0]).id);
    return true;
  }

  /** Player presses continue on a text node. A no-op while the NPC thinks. */
  advance(): DialogueStateMessage {
    if (!this.isWaiting()) this.engine.advance();
    return this.getState();
  }

  /** Player picks a choice option. Validates the option is currently visible (condition-gated). A no-op while the NPC thinks. */
  select(optionId: string): DialogueStateMessage {
    if (this.isWaiting()) return this.getState();
    const ctx = this.buildEvalContext();
    const option = this.engine.getVisibleOptions(ctx).find((opt) => opt.id === optionId);
    if (!option) {
      throw new Error(`Option "${optionId}" is not currently selectable`);
    }
    this.lastPlayerLine = interpolate(option.label, ctx);
    this.engine.selectOptionById(optionId);
    return this.getState();
  }

  /** Get all options with enabled status (includes condition-gated options as disabled). */
  getOptionsWithStatus(): Array<{ id: string; label: string; enabled: boolean }> | undefined {
    const ctx = this.buildEvalContext();
    const options = this.engine.getAllOptionsWithStatus(ctx);
    if (options.length === 0) return undefined;
    return options.map((opt) => ({
      id: opt.id,
      label: typeof opt.label === "string" ? opt.label : interpolate(opt.label, ctx),
      enabled: opt.enabled,
    }));
  }

  private buildEvalContext(): EvalContext {
    return {
      beliefs: this._npc.getAllBeliefs(),
      locals: this.locals,
      agentState: {
        player: this.makeAgentAccessor(this._player),
        npc: this.makeAgentAccessor(this._npc),
        settlement: null,
      },
      currentTick: this.currentTick,
    };
  }

  private resolveAgentRef(ref: string): Agent {
    if (ref === "$npc") return this._npc;
    if (ref === "$player") return this._player;
    throw new Error(`Unknown agent reference "${ref}" in dialogue session — only "$npc" and "$player" are supported`);
  }

  private buildMutableContext(): MutableContext {
    const ctx = this.buildEvalContext();
    return {
      ...ctx,
      npcId: this._npc.id,
      setFact: (ref: string, key: string, value: Value) => {
        const targetAgent = this.resolveAgentRef(ref);
        targetAgent.setBelief(key, { key, value, tick: this.currentTick, source: this._npc.id });
      },
      setLocal: (key: string, value: Value) => {
        this.locals.set(key, value);
      },
      giveItem: (ref: string, item: ResourceType, amount: number) => {
        const targetAgent = this.resolveAgentRef(ref);
        targetAgent.addToInventory(item, amount);
      },
      takeItem: (ref: string, item: ResourceType, amount: number): boolean => {
        const targetAgent = this.resolveAgentRef(ref);
        return targetAgent.removeFromInventory(item, amount);
      },
      damage: (ref: string, amount: number) => {
        const targetAgent = this.resolveAgentRef(ref);
        targetAgent.takeDamage(amount);
      },
    };
  }

  private makeAgentAccessor(agent: Agent): AgentAccessor {
    return {
      get(prop: string): Value {
        if (prop === "hp") return agent.hp;
        if (prop === "id") return agent.id;
        if (prop === "role") return agent.role;
        if (prop === "faction") return agent.faction;
        if (prop === "x") return agent.position.x;
        if (prop === "y") return agent.position.y;
        const inv = agent.inventory;
        if (prop in inv) return inv[prop as keyof typeof inv];
        return 0;
      },
    };
  }
}
