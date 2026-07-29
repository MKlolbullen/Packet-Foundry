# Packet Foundry

A **bidirectional, non-lossy assembler for wire formats** — craft, mutate, and torture-test
network packets at the bit level.

Where Ghidra/Cutter run the abstraction ladder *bytes → meaning* to understand a binary,
Packet Foundry runs it *meaning → bytes* to build one: you compose protocol layers and fields
(or a drag-and-drop puzzle of bitwise / arithmetic / control-flow "boxes"), and the engine lays
out offsets and resolves derived fields (checksums, lengths) into bytes. Because the byte buffer
stays authoritative, any packet — including malformed, truncated, or deliberately invalid ones —
round-trips losslessly, with diagnostics that *describe* problems rather than block them.

## Status: Phase 1 engine, Phase 2 GUI shell underway

| Crate | Role |
|-------|------|
| `packet-core` | Byte-buffer-authoritative document model: `BitRange`, `Operation` IR, layers/fields, diagnostics, JSON. |
| `protocol-engine` | Operation evaluator, dependency-ordered resolve, built-in protocols (Ethernet II, IPv4, TCP, UDP, ICMP, raw). |
| `packet-cli` | `packet-foundry` CLI — assemble packets to JSON. |
| `desktop` | Tauri + React desktop shell — the same engine crates behind a GUI. A "Build & Inspect" tab with a navigable **semantic workspace** (dive Packet → Layer → Field → Byte → Bit like zooming a map, with breadcrumbs, back/forward history, field editing with undo/redo, and cross-highlighting against a hex rail), a "Box Editor" tab (drag `Operation` boxes onto a canvas, nest/reorder/edit them, and evaluate against a scratch buffer via the real engine), and an "Assistant" tab backed by a pluggable LLM helper (OpenAI-compatible, Anthropic, or Google Gemini) that can also generate box trees from a plain-language description. |

### Quick start

```sh
cargo run -p packet-cli -- create ethernet ipv4 tcp \
  --src-ip 192.168.1.10 --dst-ip 192.168.1.20 --dst-port 443 \
  --output syn.packet.json

cargo run -p packet-cli -- inspect syn.packet.json
```

### Desktop app

```sh
cd desktop
npm install
npm run tauri dev
```

See [`docs/phase-1-design.md`](docs/phase-1-design.md) for the engine design.

## Screenshots

**Build & Inspect — the semantic workspace.** Assemble a protocol stack from JSON, then navigate
the result the way you'd zoom a map: double-click to *dive* (Packet → Layer → Field → Byte →
Bit), `Escape` to rise, `Alt+←`/`Alt+→` to walk your focus history, breadcrumbs and the outline
rail to jump anywhere. A single click selects a field and cross-highlights its exact bytes in the
hex rail at the bottom (here: IPv4's derived `HeaderChecksum`, `b7 61`). Diagnostics live in
their own rail and cross-highlight the same way. The Build/Inspect split (and every other pane
split in the app) is a draggable divider — drag to resize, double-click to reset, size persists:

![Build & Inspect: the semantic workspace, dived into the IPv4 layer](docs/screenshots/build-inspect.png)

**Field editing — Structured or Raw, with undo/redo.** Diving into a field shows its range,
value, and state (plain / derived / pinned), plus an editor: *Structured* mode takes the field's
natural form (dotted-decimal for `ipv4_addr`, colon-hex for `mac_addr`, decimal for `uint`,
`0x`-hex for `flags`), *Raw* mode takes hex bytes. Committing a value pins the field
(derivations recompute around it; a pinned value that disagrees with its own derivation raises a
diagnostic rather than being silently "fixed"). Every edit is undoable — `Ctrl+Z`/`Ctrl+Shift+Z`
or the Undo/Redo buttons by the breadcrumbs:

![Field detail with the structured editor](docs/screenshots/workspace-field-edit.png)

**The computation axis.** A derived field's "View derivation →" dives out of the packet's
*structure* and into its *computation*: the field's `Operation` tree rendered read-only with the
same box renderer the Box Editor uses. The violet accent marks the axis switch — blue is
structure, violet is computation:

![A derived field's Operation tree, rendered read-only](docs/screenshots/workspace-derivation.png)

**Box Editor** — drag `Operation` boxes onto a pannable, zoomable canvas (drag empty space to
pan, scroll to zoom, or use the toolbar's zoom/fit controls); this is the real IPv4 header
checksum expression, evaluated against the known-good test vector:

![Box Editor tab](docs/screenshots/box-editor.png)

**Control-flow boxes** — `Loop`/`If` render as Scratch/Blockly-style "C-blocks": the condition
sits inline in the header, the body is wrapped by a connecting rail instead of just another
labeled slot. Reserved (the Phase 1 evaluator doesn't execute them yet), but round-trip and
compose like any other box:

![Loop rendered as a C-block](docs/screenshots/control-flow-block.png)

**Theme** — System/Light/Dark, top-right of the header, persisted across sessions. The whole UI
is built on a CSS design-token palette, so dark mode is a first-class rich dark gray with clearly
visible borders — not a dimmed afterthought:

![Dark theme](docs/screenshots/dark-theme.png)

## LLM helper

The gear icon (top-left of the header) opens **LLM Settings** — pick a provider, model, and API
key. One "OpenAI-compatible" adapter covers OpenAI, Groq, OpenRouter, Ollama, and anything else
that speaks the `/chat/completions` shape via a configurable base URL; Anthropic and Google
Gemini get their own adapters for their native APIs. Settings are stored as plain JSON in the
app's local config directory — unencrypted, so treat it like any other local API key file.

![LLM settings](docs/screenshots/llm-settings.png)

**Assistant** — a chat tab for asking about protocols, checksums, or how to structure an
`Operation` tree. It doesn't read your packet documents automatically; paste in whatever context
you want:

![Assistant tab](docs/screenshots/assistant-tab.png)

**Generate with AI** — in the Box Editor's palette, describe the box tree you want in plain
language and it replaces the canvas with the result. The model's reply is deserialized straight
into the engine's real `Operation` type, so a reply the engine can't actually run surfaces as an
ordinary error rather than a tree that silently doesn't work:

![Generate a box tree from a description](docs/screenshots/generate-box-tree.png)

## License

MIT OR Apache-2.0.
