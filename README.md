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

## License

MIT OR Apache-2.0.
