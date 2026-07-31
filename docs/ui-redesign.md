# Packet Foundry UI Redesign Plan

## Goal

Turn Packet Foundry from a set of functional panels into an immersive packet-engineering
workbench. The primary workflow stays the same:

> Compose protocol stack → inspect semantic structure → edit fields → observe exact byte changes →
> inspect derivations and diagnostics.

The engine already supports the mechanics — protocol composition, semantic navigation
(Packet → Layer → Field → Byte → Bit), byte/bit inspection, undo/redo, diagnostics, derivation
trees, and the box editor. **This redesign reorganizes and re-presents those features; it does not
replace them.** The guiding rule:

> **The packet stays visible while the user changes abstraction level.**

## Scope decisions (read first)

Three reference mockups informed this plan. Two scope calls are deliberate and load-bearing:

1. **No dashboard / telemetry surface.** One mockup led with KPI stat tiles (Packets Sent, Success
   Rate, sparklines). We are not building that — an engineering instrument is not a metrics
   dashboard, and those numbers imply run-history telemetry the tool doesn't collect. The landing
   view is the workbench itself.
2. **No on-wire send/receive in this redesign.** The mockups show *Send Packet*, *Network
   Interfaces*, *Listener*, and *Scapy Console*. Packet Foundry is currently an **offline** crafting
   and inspection engine with no transmit path, and this plan's Definition of Done contains no send
   step. We will not add non-functional send chrome. On-wire transmission is a real, separable
   feature (it needs a privileged raw-socket helper process, kept out of the Tauri/UI process) and
   should be scoped on its own if wanted — it is explicitly **out of scope here**.

Everything else below is adopted from the "semantic workbench" direction, plus the bit-width-aware
layer visualization.

## Recommended layout

A full-window desktop layout instead of the current centered, max-width page container.

```
┌──────────────────────────────────────────────────────────────┐
│ Command bar: title · history · mode · search · theme · ⚙     │
├──────────┬───────────────┬─────────────────────┬─────────────┤
│ App nav  │ Packet stack  │ Semantic workspace  │ Inspector   │
│          │               │                     │ Diagnostics │
├──────────┴───────────────┴─────────────────────┴─────────────┤
│ Hex / ASCII / bit rail                                       │
└──────────────────────────────────────────────────────────────┘
```

- **Left application navigation** — the major workspaces only: **Packet Workbench**, **Operation
  Editor**, **Assistant**, **Settings**. Persistent, not centered tabs. (These already exist as
  `Workspace`, `BoxEditor`, `Assistant`; this is a shell-level reorganization.)
- **Packet stack rail** — the active packet as an ordered protocol stack (Ethernet II / IPv4 / TCP /
  Payload). Each layer shows: name, byte range, validation state, derived/pinned field count, a
  reorder handle, and a focus action. "Add protocol" opens the searchable protocol palette instead
  of occupying permanent space. (This is today's composer `StackView` + `ProtocolPalette`, promoted
  to the shell's left rail.)
- **Semantic workspace (center)** — visualizes the current abstraction level, `Packet → Layer →
  Field → Byte → Bit`. Double-click dives; `Escape` rises; breadcrumbs show position. (Today's
  `SemanticStage` + `WorkspaceContext` focus/history — preserved.)
- **Context inspector (right)** — changes with the selection. For a field: structured value, raw
  hex, bit range, byte offset, field type, derived/pinned/plain state, derivation preview, reset to
  derived, validation messages. Does **not** duplicate the whole packet tree. (Today's
  `FieldDetail`.)
- **Hex / ASCII / bit rail (bottom, always visible)** — the authoritative byte buffer as a memory
  map with three synchronized views (Hex, ASCII, Bits). Selecting a field highlights its bytes;
  selecting bytes highlights the owning field; diagnostics mark affected ranges in the rail.
  (Today's `HexBitRail`, extended with ASCII + bit views.)

## Semantic layer visualization (the differentiator)

Replace table-heavy layer views with **bit-width-aware diagrams**: field width ∝ bit width, wrapped
into 32-bit rows, so an IPv4 header reads as its real wire shape:

```
| Version | IHL | DSCP | ECN |        Total Length         |
|        Identification       | Flags |  Fragment Offset    |
|   TTL   |   Protocol   |         Header Checksum          |
|                     Source Address                        |
|                   Destination Address                     |
```

**This is computed from engine metadata, not hardcoded per protocol.** Every field already carries
`offset_bits` / `width_bits` (via `ParameterDescriptor` and the layer's `BitRange`s), so the
diagram lays itself out from those and stays automatic for VLAN, ICMPv6, and any protocol added
later. Start with IPv4/TCP/UDP/Ethernet validated against known layouts; fall back to a generic
sequential field layout for anything whose fields don't tile a clean grid.

## Visual system

Industrial dark by default (the existing dark tokens already are this family — keep them, tighten
spacing/contrast/hierarchy):

- Graphite background, slightly lighter working surfaces, clearly visible borders.
- **Cyan/blue** for packet structure; **violet** for computation/derivations; **amber** for
  warnings; **red** only for real errors; **green** for successfully resolved fields.
- Avoid excessive cards, gradients, glowing borders, and dashboard metrics.
- Proportional UI font for labels; monospace for hex, bit ranges, offsets, protocol constants, and
  operation expressions.

The token system (`--bg`, `--bg-panel`, `--bg-subtle`, `--border`, `--accent`, `--accent-2`,
`--warn`, `--error`, `--success`) already separates these roles. Keep it; do not fork it.

## Component structure

```
desktop/src/
├── shell/
│   ├── AppShell.tsx            # full-window grid: command bar · nav · content · rail
│   ├── CommandBar.tsx          # title, theme, settings (history/search/mode later)
│   └── WorkspaceNavigation.tsx # persistent left nav
├── composer/                   # existing — promoted to the workbench's left rail
│   ├── PacketStack.tsx (StackView), ProtocolPalette.tsx, composerModel.ts
├── semantic/
│   ├── SemanticCanvas.tsx      # existing SemanticStage
│   ├── LayerDiagram.tsx        # NEW bit-width-aware layer view
│   ├── FieldDiagram.tsx, ByteView.tsx, BitView.tsx  # existing inspectors, re-presented
├── rails/
│   ├── HexRail.tsx             # existing HexBitRail + ASCII/bit views
│   ├── DiagnosticsRail.tsx, HistoryControls.tsx     # existing DiagnosticsPanel + undo/redo
└── operations/
    └── OperationWorkbench.tsx  # existing BoxEditor / OperationProjection
```

**Reuse the existing `WorkspaceContext` and `documentHistory` reducer. Do not introduce a second
selection or undo model.** The shell reparents existing components; it does not re-implement them.

## Implementation order

- **Phase 1 — Application shell.** Replace the centered header + tabs with a full-height shell:
  persistent left navigation, a compact command bar, resizable content regions. **No packet
  behavior changes.** The existing Workspace/BoxEditor/Assistant mount unchanged into the content
  region.
- **Phase 2 — Packet stack & inspector.** Promote composer stack/palette into the left rail and
  field editing into the right inspector. Tauri commands and the document model stay unchanged.
- **Phase 3 — Semantic layer visualization.** The bit-width-aware `LayerDiagram`, computed from
  field `offset_bits`/`width_bits`, with a generic fallback.
- **Phase 4 — Hex synchronization.** Deterministic, keyboard-accessible bidirectional highlighting
  across layer diagram ↔ field inspector ↔ hex rail ↔ diagnostics; add ASCII + bit views to the
  rail.
- **Phase 5 — Operation integration.** Let a derived field flip from the structural axis to the
  computation axis in place, rendering its derivation with the same (read-only) operation renderer
  the Box Editor uses, without a full context switch.

## Definition of done

A user can, without editing JSON:

1. Create an Ethernet/IPv4/TCP packet.
2. Understand the packet's layout visually.
3. Select a field and immediately see its exact bytes.
4. Edit a structured value and observe byte-level changes.
5. Pin or unpin derived fields.
6. Follow a checksum or length derivation.
7. Navigate packet → bit level without losing context.
8. Undo every packet mutation.
9. Understand malformed packets without the UI blocking them.
10. Use the app efficiently with keyboard and mouse.

Everything else is secondary to: **the packet stays visible while the user changes abstraction
level.**
