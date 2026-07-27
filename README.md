# Packet Foundry

A **bidirectional, non-lossy assembler for wire formats** — craft, mutate, and torture-test
network packets at the bit level.

Where Ghidra/Cutter run the abstraction ladder *bytes → meaning* to understand a binary,
Packet Foundry runs it *meaning → bytes* to build one: you compose protocol layers and fields
(and, eventually, a drag-and-drop puzzle of bitwise / arithmetic / control-flow "boxes"), and
the engine lays out offsets and resolves derived fields (checksums, lengths) into bytes. Because
the byte buffer stays authoritative, any packet — including malformed, truncated, or deliberately
invalid ones — round-trips losslessly, with diagnostics that *describe* problems rather than
block them.

## Status: Phase 1 engine, Phase 2 GUI shell underway

| Crate | Role |
|-------|------|
| `packet-core` | Byte-buffer-authoritative document model: `BitRange`, `Operation` IR, layers/fields, diagnostics, JSON. |
| `protocol-engine` | Operation evaluator, dependency-ordered resolve, built-in protocols (Ethernet II, IPv4, TCP, UDP, ICMP, raw). |
| `packet-cli` | `packet-foundry` CLI — assemble packets to JSON. |
| `desktop` | Tauri + React desktop shell — the same engine crates behind a GUI. A "Build & Inspect" JSON builder/inspector, plus a "Box Editor" tab: drag `Operation` boxes onto a canvas, nest/reorder/edit them, and evaluate against a scratch buffer via the real engine. |

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

**Build & Inspect** — assemble a protocol stack from JSON, inspect the resolved layer/field tree
and diagnostics:

![Build & Inspect tab](docs/screenshots/build-inspect.png)

**Box Editor** — drag `Operation` boxes onto a pannable, zoomable canvas (drag empty space to
pan, scroll to zoom, or use the toolbar's zoom/fit controls); this is the real IPv4 header
checksum expression, "Fit" to frame it after evaluating it against the known-good test vector:

![Box Editor tab](docs/screenshots/box-editor.png)

**Control-flow boxes** — `Loop`/`If` render as Scratch/Blockly-style "C-blocks": the condition
sits inline in the header, the body is wrapped by a connecting rail instead of just another
labeled slot. Reserved (the Phase 1 evaluator doesn't execute them yet), but round-trip and
compose like any other box:

![Loop rendered as a C-block](docs/screenshots/control-flow-block.png)

**Theme** — System/Light/Dark, top-right of the header, persisted across sessions:

![Dark theme](docs/screenshots/dark-theme.png)

## License

MIT OR Apache-2.0.
