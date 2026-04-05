import type { DialogueTreeData, Value, ResourceType } from "@town-zero/shared";
import { DialogueEngine } from "./dialogue-engine.js";
import { interpolate, type EvalContext, type AgentAccessor } from "./evaluator.js";
import type { MutableContext } from "./executor.js";
import type { Agent } from "../simulation/agent.js";
import type { TriggerRegistry } from "./trigger-registry.js";

export interface DialogueStateMessage {
  treeId: string;
  nodeId: string;
  type: "text" | "choice" | "request_pending" | "end";
  speaker: string;
  text: string;
  options?: Array<{ id: string; label: string }>;
}

export class DialogueSession {
  private engine: DialogueEngine;
  private _npc: Agent;
  private _player: Agent;
  private currentTick: number;
  private triggerRegistry?: TriggerRegistry;
  private locals: Map<string, Value> = new Map();
  private disposed = false;

  // Timeout tracking
  startTick: number;
  lastInteractionTick: number;

  constructor(opts: {
    tree: DialogueTreeData;
    npc: Agent;
    player: Agent;
    currentTick: number;
    triggerRegistry?: TriggerRegistry;
  }) {
    this.engine = new DialogueEngine(opts.tree);
    this._npc = opts.npc;
    this._player = opts.player;
    this.currentTick = opts.currentTick;
    this.triggerRegistry = opts.triggerRegistry;
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

      case "request":
        return {
          treeId,
          nodeId,
          type: "request_pending",
          speaker: "npc",
          text: interpolate(node.label, ctx),
        };

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

  /** Player presses continue on a text node. */
  advance(): DialogueStateMessage {
    this.engine.advance();
    return this.getState();
  }

  /** Player picks a choice option. Validates the option is currently visible (condition-gated). */
  select(optionId: string): DialogueStateMessage {
    const visible = this.engine.getVisibleOptions(this.buildEvalContext());
    if (!visible.some((opt) => opt.id === optionId)) {
      throw new Error(`Option "${optionId}" is not currently selectable`);
    }
    this.engine.selectOptionById(optionId);
    return this.getState();
  }

  /** LLM resolves a request node. */
  resolveRequest(accepted: boolean): DialogueStateMessage {
    this.engine.resolveRequest(accepted);
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
        this.triggerRegistry?.recordChangedFact(key);
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
      registerTrigger: (rule) => {
        this.triggerRegistry?.register(rule);
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
