# protocols/

**Declarative protocol descriptors** (Phase 2). Each `*.json` file defines a protocol as data:
fields with layer-relative offsets and derivations written against *symbolic labels*. At assemble
time the engine's linker ([`protocol_engine::descriptor::lower`]) resolves those labels into the
absolute-offset `Operation` IR — the same output the hand-written Rust builders in
`crates/protocol-engine/src/protocols/` produce (proven byte-identical by
`crates/protocol-engine/tests/descriptors.rs`).

## Schema

```jsonc
{
  "name": "IPv4",
  "header_len": 20,                    // bytes
  "fields": [
    { "name": "Version",
      "offset_bits": 0, "width_bits": 4,  // relative to the layer start
      "kind": "uint",                     // uint | bytes | mac_addr | ipv4_addr | flags
      "default": [4] },                   // optional big-endian default bytes
    { "name": "TotalLength", "offset_bits": 16, "width_bits": 16, "kind": "uint",
      "derivation": { "LengthToEnd": { "width": 2 } } }
  ]
}
```

## Symbolic derivation labels (`DExpr`)

| Label | Meaning | Lowers to |
|-------|---------|-----------|
| `{"Const": [..]}` | fixed bytes | `Const` |
| `"ThisLayer"` | this layer's header span | `ReadRange` |
| `"ToEnd"` | this layer's start → end of buffer | `ReadFrom` |
| `{"LengthToEnd": {"width": n}}` | byte count to end, `n` BE bytes | `ByteLength` |
| `{"Field": "Name"}` | a field in this layer | `ReadRange` |
| `{"LayerField": ["IPv4", "SrcAddr"]}` | a field in another placed layer | `ReadRange` |
| `{"Checksum": [..]}` | internet checksum over the parts | `internet_checksum` |
| `{"Concat": [..]}` | concatenation | `Concat` |

Labels keep descriptors position-independent; the linker binds them to concrete offsets once the
layer stack is laid out.
