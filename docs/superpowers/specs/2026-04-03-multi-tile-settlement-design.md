# Multi-Tile Settlement Design

## Problem

Settlements currently render as a single tile marker (gold/purple square) despite having a 5×5 territory. Players cannot see individual buildings or settlement layout on the map. The data model syncs only the first territory tile's coordinates, and structures have positions that the client never renders.

## Goals

- Settlements visually occupy multiple tiles on the world map
- Each building (zone) is visible on its tile with distinct color and icon
- Players can walk into settlements and see the internal layout
- Data model cleanly separates terrain from zone designation
- Future-proof for dynamic building and fine-grained objects (walls, beds, doors)

## Non-Goals

- Dynamic building/destruction (future work)
- Procedural settlement layout generation (future work — MVP uses handwritten templates)
- Object layer (walls, beds, doors — future work, separate from zone layer)
- Movement system changes (active development on separate branch)

## Design

### Dual-Layer Tile Model

Each tile has two independent layers:

1. **Terrain layer** (existing) — the natural ground type (`"plains"`, `"forest"`, `"mountain"`, `"water"`, `"road"`). Preserved when a zone is placed. Determines base visual appearance.
2. **Zone layer** (new) — the functional designation of the tile within a settlement. Determines game mechanics (population cap, production, interaction point).

The two layers are independent. A production zone on a forest tile is a forest with a farm on it. Removing the zone (future) restores the tile to plain forest. This follows the RimWorld/Dwarf Fortress pattern where buildings overlay terrain rather than replacing it.

### ZoneType Enum

```typescript
enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
  PRODUCTION = "production",
}
```

String enum for debuggability and Colyseus schema compatibility (syncs as `"string"` type). Used in both simulation and schema layers.

Defined in `shared/src/constants.ts` alongside existing constants.

### Core Zone

Each settlement has exactly one `CORE` zone — its anchor and meeting point.

- **Indestructible** — cannot be removed by any game action
- **Meeting point** — serves as the default destination for NPC resource delivery and player interaction
- **Settlement anchor** — `SettlementSchema.x/y` syncs to the core's coordinates
- Village variant: Town Hall
- Den variant: Hive Core

### Settlement Territory

Territory is defined as: all tiles whose `ownerFaction` matches the settlement's faction. In MVP, this is set at map generation time from the template.

Territory consists of:
- **Zone tiles** — tiles with a non-empty `zoneType` (core, housing, production)
- **Open tiles** — tiles within territory but with `zoneType === EMPTY` (available for future construction)

### Schema Changes

**TileSchema** — add one field:

```typescript
TileSchema = schema({
  x: "number",
  y: "number",
  terrain: "string",
  resourceYield: "string",
  ownerFaction: "string",
  zoneType: "string",        // new — ZoneType enum value
})
```

**SettlementSchema** — `x, y` semantics change:

- Before: coordinates of `territory[0]` (arbitrary first tile)
- After: coordinates of the core zone's tile (the settlement's anchor point)

**StructureSchema** — unchanged. `x, y` now have rendering significance since the client uses `zoneType` on tiles directly.

### Settlement Templates

MVP uses handwritten 2D array templates stamped onto the grid at map generation.

```typescript
const _ = ZoneType.EMPTY;
const C = ZoneType.CORE;
const H = ZoneType.HOUSING;
const P = ZoneType.PRODUCTION;

const VILLAGE_TEMPLATE = [
  [_, P, _, H, _],
  [_, _, _, _, _],
  [_, H, C, P, _],
  [_, _, _, _, _],
  [_, _, _, _, _],
];

const DEN_TEMPLATE = [
  [_, H, _, _],
  [_, C, P, _],
  [_, _, _, _],
  [_, _, _, _],
];
```

The generator stamps a template centered on the core's world position:
1. For each cell in the template, compute world coordinates relative to core position
2. Set `ownerFaction` on the tile
3. Set `zoneType` on the tile
4. Create a `Structure` object for each non-empty zone
5. Seed settlement inventory and NPC agents as before

### Map Generator Changes

Replace the current `rect()` territory + manual `addStructure()` approach with template stamping:

```
generateMap flow (revised):
  1. Choose core positions for village and den (existing logic)
  2. Stamp VILLAGE_TEMPLATE centered on village core position
  3. Stamp DEN_TEMPLATE centered on den core position
  4. For each stamped zone tile:
     a. Set tile.ownerFaction = settlement.faction
     b. Set tile.zoneType = template value
     c. Create Structure { id, type, position, operatorId: null }
  5. For each empty template tile:
     a. Set tile.ownerFaction = settlement.faction (territory)
     b. zoneType remains EMPTY
  6. Create Settlement with territory, structures, seed inventory
  7. Spawn NPC agents on open tiles within territory
```

### Sync Changes

**`syncTile()`** — add `zoneType` field synchronization:

```typescript
schema.zoneType = tile.zoneType;
```

**`syncSettlement()`** — change `x, y` source:

```typescript
const core = settlement.structures.find(s => s.type === ZoneType.CORE);
schema.x = core?.position.x ?? 0;
schema.y = core?.position.y ?? 0;
```

### Renderer Changes

Replace the single-tile `drawSettlement()` method with zone overlay rendering in the tile drawing loop.

**Rendering order per tile:**
1. Draw terrain base (existing — `drawTerrain()`)
2. Draw zone overlay (new — `drawZoneOverlay()`)
3. Draw agents (existing — `drawAgent()`)

**Zone overlay visual spec:**

| ZoneType | Fill | Marker | Opacity |
|---|---|---|---|
| `CORE` | Faction color (gold for village, purple for den) | Star or flag symbol | 0.6 |
| `HOUSING` | Warm tone (#c4843a) | `H` | 0.5 |
| `PRODUCTION` | Green tone (#5a9e4b) | `P` | 0.5 |
| `EMPTY` + in territory | Faction color | None | 0.1 border only |
| `EMPTY` + not in territory | Nothing | Nothing | — |

Fog of war applies uniformly — `explored` tiles render at 50% opacity, `unknown` tiles are hidden. No special fog logic needed for zones.

**Delete:** `drawSettlement()` method and the settlement rendering loop that calls it. Settlements no longer need separate rendering — zones are drawn per-tile.

### Command System Impact

Existing commands continue to work without modification:

- **`deposit` / `take`**: Check `settlement.isInTerritory(agent.position)` — territory is still defined by `ownerFaction` match, unchanged
- **`operate`**: Currently checks structure position match. Can optionally be simplified to check `tile.zoneType === PRODUCTION`, but not required for this change

No new commands are added.

### Bot AI Impact

`decideBotAction()` does not need changes. It reads settlement state and agent state, not tile details. Future improvement: bots prefer core tile for deposit runs (not in scope).

### What This Design Does NOT Touch

- **Movement system** — active development on a separate branch. This design only affects tile data, rendering, map generation, and sync. Agent movement, pathfinding, and collision are out of scope.
- **Agent schema/simulation** — no changes to Agent fields or behavior
- **Food consumption / starvation** — unchanged
- **Production cycle** — logic unchanged, only the way production structures are placed changes
- **Merchant / vision / memory merge** — unchanged
- **Client input / camera / network** — unchanged

## Future Extensions

### Object Layer (Phase 2)

A separate object layer for fine-grained placeable items:

- `wall` — blocks passage on tile edges
- `door` — passable wall segment
- `bed` — furniture inside rooms
- `workbench` — production equipment

The object layer is independent of the zone layer. A production zone can have a workbench object on it. A housing zone can have beds and walls forming rooms. This separation means the object layer can be added without modifying zone mechanics.

### Dynamic Building (Phase 3)

- `build` command: agent places a new zone or object, consuming resources
- `destroy` command: agent removes a zone or object
- Territory expands organically as buildings are placed adjacent to existing territory
- Procedural layout generation replaces handwritten templates

### Terrain-Zone Interaction (Phase 4)

- Terrain type affects zone efficiency (forest + production = lumber bonus)
- Original terrain preserved under zones enables this without data model changes
