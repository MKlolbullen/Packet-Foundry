# Packet Foundry — Phase 1: Headless Packet Engine

## Context

Packet Foundry is a visual packet-crafting tool. The eventual GUI is a **drag-and-drop
puzzle of composable "boxes"** — bitwise ops, arithmetic, control flow (loop/do-while),
and reusable functions — stacked into protocol layers and full packets. The confirmed
mental model is **recursive composition ("zoomable boxes")**: every box is either a
primitive bit/byte op or a bundle of smaller boxes; you zoom into any box to see the
layer beneath, all the way down to bits. Checksums, length fields, protocols, functions,
and loops are all boxes at different heights.

The dragon is not the UI — it is reliable bit-level mutation plus a computation model
general enough that the future puzzle pieces are just constructors over the same core.
So Phase 1 builds a **headless, deterministic Rust engine** we can torture-test before any
pixels exist. First deliverable: a runnable workspace + a CLI that crafts a valid TCP SYN
packet to JSON.

Framed by analogy: Ghidra/Cutter run the abstraction ladder **bytes → meaning** to *understand*
a binary; Packet Foundry runs it **meaning → bytes** to *build* one — i.e. an **assembler**
(build structure → lay out offsets → resolve derivations → emit bytes), where the "assembly
language" is the recursive box IR rather than x86. Because bytes stay authoritative it is a
*bidirectional, non-lossy* assembler: structure↔bytes kept in sync, so a mangled byte still
round-trips and merely raises a diagnostic — an assembler's synthesis and a disassembler's
analysis in one live document.

**Key commitment (avoids the "cursed corner"):** checksums and length fields are *not* a
special subsystem — they are the first instances of a small, general **operation IR** (the
seed of the box language). `Loop`/`If`/`Call` are designed into the IR as reserved variants,
not executed in Phase 1.

## Confirmed decisions
- **Byte-buffer authoritative:** one `Vec<u8>` is the source of truth; layers/fields are
  `BitRange` views. Any bit pattern (malformed / truncated / invalid) is always
  representable; the semantic tree derives from bytes.
- **Recursive composition:** one uniform `Operation` IR — primitive | composite(subgraph) |
  structured(loop/if — reserved). Protocols and checksums are authored *as* this IR.
- **Derivation pass (batch):** derived fields (checksums, lengths) are evaluated in dependency
  order during assembly (the resolve pass). Per-field **override/pin** suspends a derivation to
  craft deliberately-wrong values (a diagnostic flags the mismatch). Incremental/reactive
  recompute (dirty-propagation on each edit) is deferred to the interactive GUI phase.
- **Errors:** `thiserror` enums, `Result` everywhere, never panic on malformed input.
- **JSON:** self-contained — canonical bytes (hex) + structure tree + embedded derivation
  graphs + overrides + diagnostics. Round-trips exactly, including broken packets.
- **Sync, single-threaded core.** Edition 2024 (rustc 1.96 available).

## Workspace layout
```
packet-foundry/
├─ Cargo.toml                 # workspace
├─ crates/
│  ├─ packet-core/            # data model (no protocol / eval logic)
│  ├─ protocol-engine/        # evaluator + protocol registry
│  └─ packet-cli/             # `packet-foundry` binary
└─ protocols/                 # reserved for future declarative descriptors (README only)
```
Dependency DAG: `packet-cli → protocol-engine → packet-core`.

## crates/packet-core (the data model)
Pure, serializable, dependency-light (`serde`, `thiserror`, `hex`).
- `bitrange.rs` — `BitRange { start_bit, len_bits }`; **strict bounds-checked** bit read/write
  across byte boundaries in network (big-endian) order: `read_bits` / `write_bits ->
  Result<_, CoreError>`. Never panics. This is the dragon; the heaviest test target.
- `buffer.rs` — `PacketBuffer(Vec<u8>)` wrapper over the above.
- `operation.rs` — the **IR as data**:
  `enum Operation { Const(Vec<u8>), ReadRange(BitRange), And/Or/Xor/Not, Shl/Shr, Add/Sub,
  OnesComplementSum(Vec<Operation>), ByteLength(BitRange), Concat(Vec<Operation>),
  Composite { name, body: Box<Operation> }, /* reserved */ Loop{..}, If{..}, Call{name} }`.
  Serializable — these are the "boxes."
- `node.rs` — structure tree: `Layer { name, range, fields }`,
  `Field { name, range, kind, derivation: Option<Operation>, override_bytes: Option<Vec<u8>> }`.
- `document.rs` — `PacketDocument { buffer, layers, diagnostics, history(in-mem) }` — the artifact.
- `history.rs` — undo/redo via reversible byte-diff edits (`Edit { range, before, after }`) +
  structural add/remove. In-memory only in Phase 1 (not serialized).
- `diagnostics.rs` — `Diagnostic { severity, code, message, location }`. Because bytes are
  authoritative, malformed packets **load**; diagnostics *describe* problems (bad checksum,
  truncation, range overlap, out-of-range field) rather than block loading.
- JSON via serde derives — schema = bytes(hex) + tree + embedded derivations + overrides +
  diagnostics.

## crates/protocol-engine (behavior)
Depends on `packet-core`.
- `eval.rs` — `evaluate(op, &buffer, ctx) -> Result<Vec<u8>, EngineError>`: tree-walks
  `Operation`. Composite = evaluate body. Reserved variants (Loop/If/Call) return
  `EngineError::Unsupported` for now (documented seam).
- `deps.rs` — dependency graph: collect the input ranges each field derivation reads, then use it
  to (a) evaluate derivations in **topological order** during assembly and (b) flag
  override-vs-computed mismatches. Cycle detection → diagnostic, never an infinite loop.
  Incremental dirty-propagation is deferred (batch resolve for now).
- `protocols/` — builders emitting core structures + derivations:
  - `ethernet.rs` (14 B: dst/src MAC, ethertype)
  - `ipv4.rs` (20 B, no options; **TotalLength** = `ByteLength`; **HeaderChecksum** =
    `OnesComplementSum` over header ranges)
  - `tcp.rs` (20 B, no options; **Checksum** = `OnesComplementSum` over IPv4 pseudo-header +
    TCP segment — the cross-layer dependency, the best torture test; DataOffset fixed at 5)
  - `raw.rs` (arbitrary payload bytes)
- `registry.rs` — name → builder; `stack(layers)` concatenates into the buffer and assigns
  absolute offsets.

## crates/packet-cli
`clap`-based `packet-foundry` binary.
- `create <proto...> [flags] --output f.json` — build via registry, apply flags, recompute
  derivations, write JSON. Flags for the SYN example: `--src-ip/--dst-ip`,
  `--src-port/--dst-port`, `--seq`, `--flags syn`, `--src-mac/--dst-mac`. Not every field
  needs a flag — post-edit the JSON for the rest.
- `inspect <f.json>` — load + print the structure tree + diagnostics (the verification /
  torture surface).

## Testing (torture-first)
- **Unit:** BitRange bounds + cross-byte + sub-byte (IHL / flags / data-offset) read/write;
  evaluator ops; protocol field offsets.
- **Known-good vectors:** hardcode a real SYN's bytes + expected IPv4/TCP checksums (reference
  values) to validate the checksum math.
- **Torture integration:** malformed (wrong checksum survives + diagnostic), truncated (layer
  longer than buffer), invalid (IHL claims options that aren't there, overlapping ranges,
  out-of-bounds field). All must load without panicking and emit precise diagnostics.
- **Property (`proptest`):** round-trip invariant — arbitrary `Vec<u8>` → wrap → serialize →
  deserialize → identical bytes; any document → JSON → document is byte-identical.

## Deferred (explicitly out of Phase 1)
- Executing `Loop`/`If`/`Call`; user-defined function library / authoring.
- Incremental reactive recompute (dirty-propagation) — Phase 1 resolves derivations in a batch pass.
- Declarative protocol file format + loader (the `protocols/` dir is reserved).
- IPv4/TCP options (variable-length; needs loops).
- All GUI (Tauri/React).

## Verification (end-to-end)
1. `cargo build` and `cargo test` green (unit + torture + proptest).
2. Run the target command:
   `packet-foundry create ethernet ipv4 tcp --src-ip 192.168.1.10 --dst-ip 192.168.1.20 --dst-port 443 --output syn.packet.json`
3. `packet-foundry inspect syn.packet.json` → correct layer/field tree, **zero** diagnostics,
   checksums matching the known-good vector.
4. Cross-check emitted bytes against a documented reference SYN (valid IPv4 + TCP checksums).
5. Torture: hand-corrupt one byte in the JSON, re-`inspect` → still loads, flags the checksum
   mismatch, no panic.
