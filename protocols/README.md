# protocols/

Reserved for **future declarative protocol descriptors**.

In Phase 1, protocols (Ethernet II, IPv4, TCP, raw) are authored in Rust as builders in
`crates/protocol-engine/src/protocols/`, each emitting the same `Operation` IR that will later
be expressible as data here. Keeping this directory reserved marks the seam where a data-driven
loader plugs in without reworking the engine.
