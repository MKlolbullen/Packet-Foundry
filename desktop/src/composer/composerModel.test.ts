import { describe, expect, it } from "vitest";
import type { ParameterDescriptor, ProtocolCatalogEntry } from "../types";
import {
  EMPTY_MODEL,
  addLayer,
  formControlsFor,
  hasTriState,
  isUserEditable,
  makeLayer,
  moveLayer,
  paletteCandidates,
  setFieldMode,
  setFieldValue,
  toPayload,
} from "./composerModel";

function desc(over: Partial<ParameterDescriptor> & { name: string }): ParameterDescriptor {
  return {
    kind: "uint",
    offset_bits: 0,
    width_bits: 16,
    default: [0, 0],
    role: "editable",
    ...over,
  };
}

// A trimmed catalogue with just the compatibility edges and field roles the tests exercise.
const CATALOG: ProtocolCatalogEntry[] = [
  {
    id: "ethernet", display_name: "Ethernet II", category: "link",
    allowed_parents: [], allowed_children: ["ipv4", "ipv6", "arp", "vlan"],
    fields: [
      desc({ name: "DstMac", kind: "mac_addr", width_bits: 48, default: [0, 0, 0, 0, 0, 0] }),
      desc({ name: "EtherType", role: "auto_linked", default: [0x08, 0x00] }),
    ],
  },
  {
    id: "ipv4", display_name: "IPv4", category: "network",
    allowed_parents: ["ethernet", "vlan"], allowed_children: ["tcp", "udp", "icmp"],
    fields: [
      desc({ name: "Version", role: "fixed", width_bits: 4, default: [4] }),
      desc({ name: "TTL", width_bits: 8, default: [64] }),
      desc({ name: "Protocol", role: "auto_linked", width_bits: 8, default: [6] }),
      desc({ name: "HeaderChecksum", role: "derived", default: [0, 0] }),
    ],
  },
  {
    id: "ipv6", display_name: "IPv6", category: "network",
    allowed_parents: ["ethernet", "vlan"], allowed_children: ["tcp", "udp", "icmpv6"],
    fields: [desc({ name: "NextHeader", role: "auto_linked", width_bits: 8, default: [6] })],
  },
  {
    id: "tcp", display_name: "TCP", category: "transport",
    allowed_parents: ["ipv4", "ipv6"], allowed_children: ["raw"],
    fields: [desc({ name: "SrcPort", default: [0, 0] })],
  },
  {
    id: "raw", display_name: "Payload", category: "payload",
    allowed_parents: ["tcp", "udp", "icmp", "icmpv6"], allowed_children: [],
    fields: [desc({ name: "Data", kind: "bytes", width_bits: 0, default: [] })],
  },
];

const entry = (id: string) => CATALOG.find((e) => e.id === id)!;

describe("paletteCandidates", () => {
  it("offers roots for an empty stack", () => {
    expect(paletteCandidates(CATALOG, EMPTY_MODEL)).toEqual(["ethernet"]);
  });

  it("offers the tail layer's allowed children", () => {
    let m = addLayer(EMPTY_MODEL, entry("ethernet"), "k1");
    expect(paletteCandidates(CATALOG, m)).toEqual(["ipv4", "ipv6", "arp", "vlan"]);
    m = addLayer(m, entry("ipv4"), "k2");
    expect(paletteCandidates(CATALOG, m)).toEqual(["tcp", "udp", "icmp"]);
  });

  it("distinguishes IPv4 (icmp) from IPv6 (icmpv6) children", () => {
    const m = addLayer(addLayer(EMPTY_MODEL, entry("ethernet"), "k1"), entry("ipv6"), "k2");
    const kids = paletteCandidates(CATALOG, m);
    expect(kids).toContain("icmpv6");
    expect(kids).not.toContain("icmp");
  });
});

describe("toPayload", () => {
  it("emits no pins for an all-default stack", () => {
    const m = addLayer(addLayer(EMPTY_MODEL, entry("ethernet"), "k1"), entry("ipv4"), "k2");
    const payload = toPayload(m);
    expect(payload.layers).toEqual([{ protocol: "ethernet" }, { protocol: "ipv4" }]);
    expect(payload.pins).toEqual([]);
  });

  it("emits a pin with big-endian width bytes when a field is edited", () => {
    let m = addLayer(addLayer(EMPTY_MODEL, entry("ethernet"), "k1"), entry("ipv4"), "k2");
    m = setFieldValue(m, "k2", "TTL", "01");
    expect(toPayload(m).pins).toEqual([{ layer_index: 1, field_name: "TTL", bytes: [0x01] }]);
  });

  it("emits a pin for a pinned auto-linked field, none when Auto", () => {
    let m = addLayer(EMPTY_MODEL, entry("ethernet"), "k1");
    expect(toPayload(m).pins).toEqual([]); // EtherType is Auto by default
    m = setFieldMode(m, "k1", "EtherType", "invalid");
    m = setFieldValue(m, "k1", "EtherType", "beef");
    expect(toPayload(m).pins).toEqual([{ layer_index: 0, field_name: "EtherType", bytes: [0xbe, 0xef] }]);
    m = setFieldMode(m, "k1", "EtherType", "auto");
    expect(toPayload(m).pins).toEqual([]); // back to Auto clears the pin
  });

  it("emits Raw bytes in the spec, not as a pin", () => {
    let m = addLayer(addLayer(addLayer(EMPTY_MODEL, entry("ethernet"), "k1"), entry("ipv4"), "k2"), entry("tcp"), "k3");
    m = addLayer(m, entry("raw"), "k4");
    m = setFieldValue(m, "k4", "Data", "68656c6c6f");
    const payload = toPayload(m);
    expect(payload.layers[3]).toEqual({ protocol: "raw", raw_bytes: [0x68, 0x65, 0x6c, 0x6c, 0x6f] });
    expect(payload.pins.some((p) => p.layer_index === 3)).toBe(false);
  });
});

describe("formControlsFor / role predicates", () => {
  it("yields one control per field, tagged by role", () => {
    const layer = makeLayer(entry("ipv4"), "k1");
    const controls = formControlsFor(entry("ipv4"), layer);
    expect(controls.map((c) => c.name)).toEqual(["Version", "TTL", "Protocol", "HeaderChecksum"]);
    expect(controls.map((c) => c.role)).toEqual(["fixed", "editable", "auto_linked", "derived"]);
  });

  it("classifies editability and tri-state by role", () => {
    expect(isUserEditable("editable")).toBe(true);
    expect(isUserEditable("auto_linked")).toBe(true);
    expect(isUserEditable("derived")).toBe(false);
    expect(isUserEditable("fixed")).toBe(false);
    expect(hasTriState("auto_linked")).toBe(true);
    expect(hasTriState("editable")).toBe(false);
  });

  it("seeds control state from the descriptor default", () => {
    const layer = makeLayer(entry("ipv4"), "k1");
    const ttl = formControlsFor(entry("ipv4"), layer).find((c) => c.name === "TTL")!;
    expect(ttl.state).toEqual({ mode: "auto", hex: "40" });
  });
});

describe("moveLayer", () => {
  it("keeps a field's pin attached to its layer across a reorder", () => {
    let m = addLayer(addLayer(EMPTY_MODEL, entry("ethernet"), "k1"), entry("ipv4"), "k2");
    m = setFieldValue(m, "k2", "TTL", "0a");
    // Move IPv4 to the head; its pin's layer_index must follow to 0.
    m = moveLayer(m, "k2", -1);
    expect(m.layers.map((l) => l.protocolId)).toEqual(["ipv4", "ethernet"]);
    expect(toPayload(m).pins).toEqual([{ layer_index: 0, field_name: "TTL", bytes: [0x0a] }]);
  });

  it("is a no-op at the edges", () => {
    const m = addLayer(EMPTY_MODEL, entry("ethernet"), "k1");
    expect(moveLayer(m, "k1", -1)).toBe(m);
    expect(moveLayer(m, "k1", 1)).toBe(m);
  });
});
