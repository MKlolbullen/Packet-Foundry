// Mirrors the JSON shapes serde produces for packet-core / protocol-engine types.
// See crates/packet-core/src/{bitrange,node,diagnostics,document}.rs and
// crates/protocol-engine/src/registry.rs for the Rust source of truth.

export interface BitRange {
  start_bit: number;
  len_bits: number;
}

// --- Protocol catalogue (composer) — mirrors protocol_engine::catalog ---

export type ProtocolCategory = "link" | "network" | "transport" | "application" | "payload";

/** How a field participates in the composer form — mirrors `ParameterRole`. */
export type ParameterRole = "editable" | "derived" | "auto_linked" | "fixed";

export interface ParameterDescriptor {
  name: string;
  kind: FieldKind;
  offset_bits: number;
  width_bits: number;
  /** Default bytes, in the same encoding a `FieldPin` uses. */
  default: number[];
  role: ParameterRole;
}

export interface ProtocolCatalogEntry {
  id: string;
  display_name: string;
  category: ProtocolCategory;
  allowed_parents: string[];
  allowed_children: string[];
  fields: ParameterDescriptor[];
}

/** A pinned field value — mirrors `protocol_engine::FieldPin`. */
export interface FieldPin {
  layer_index: number;
  field_name: string;
  bytes: number[];
}

// --- Semantic diff — mirrors protocol_engine::diff ---

export type FieldState = "plain" | "derived" | "pinned";
export type FieldChange = "unchanged" | "direct_edit" | "derived_consequence" | "state_only";
export type LayerStatus = "unchanged" | "modified" | "added" | "removed";

export interface FieldSnapshot {
  name: string;
  kind: FieldKind;
  range: BitRange;
  state: FieldState;
  value: string;
}

export interface FieldDiff {
  name: string;
  kind: FieldKind;
  range_before: BitRange;
  range_after: BitRange;
  state_before: FieldState;
  state_after: FieldState;
  value_before: string;
  value_after: string;
  change: FieldChange;
}

export interface LayerDiff {
  name: string;
  status: LayerStatus;
  fields_added: FieldSnapshot[];
  fields_removed: FieldSnapshot[];
  fields_changed: FieldDiff[];
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface ByteDiff {
  changed: ByteRange[];
  len_before: number;
  len_after: number;
}

export interface DiagnosticsDiff {
  added: Diagnostic[];
  removed: Diagnostic[];
}

export interface PacketDiff {
  layers: LayerDiff[];
  bytes: ByteDiff;
  diagnostics: DiagnosticsDiff;
}

export type FieldKind = "uint" | "bytes" | "mac_addr" | "ipv4_addr" | "ipv6_addr" | "flags";

export interface Field {
  /** Stable identity (Rust `NodeId`, a `u64`) — `0` means unassigned. */
  id: number;
  name: string;
  range: BitRange;
  kind: FieldKind;
  derivation?: unknown;
  override_bytes?: number[];
}

export interface Layer {
  /** Stable identity (Rust `NodeId`, a `u64`) — `0` means unassigned. */
  id: number;
  name: string;
  range: BitRange;
  fields: Field[];
}

export type Severity = "info" | "warning" | "error";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  location?: BitRange;
}

export interface PacketDocument {
  version: number;
  /** Canonical bytes, hex-encoded. */
  buffer: string;
  layers: Layer[];
  diagnostics: Diagnostic[];
}

export interface EthernetParams {
  dst_mac: number[];
  src_mac: number[];
  ethertype: number;
}

export interface VlanParams {
  /** Priority Code Point (0–7). */
  priority: number;
  dei: boolean;
  /** VLAN identifier (0–4095). */
  vlan_id: number;
}

export interface Ipv4Params {
  dscp_ecn: number;
  identification: number;
  flags_frag: number;
  ttl: number;
  protocol: number;
  src: number[];
  dst: number[];
}

export interface Ipv6Params {
  traffic_class: number;
  flow_label: number;
  next_header: number;
  hop_limit: number;
  /** 16 bytes. */
  src: number[];
  /** 16 bytes. */
  dst: number[];
}

export interface ArpParams {
  /** 1 = request, 2 = reply. */
  oper: number;
  sender_mac: number[];
  sender_ip: number[];
  target_mac: number[];
  target_ip: number[];
}

export interface TcpParams {
  src_port: number;
  dst_port: number;
  seq: number;
  ack: number;
  flags: number;
  window: number;
  urgent: number;
}

export interface UdpParams {
  src_port: number;
  dst_port: number;
}

export interface IcmpParams {
  icmp_type: number;
  code: number;
  identifier: number;
  sequence: number;
}

export interface Icmpv6Params {
  icmp_type: number;
  code: number;
}

/** Mirrors `ProtocolSpec`'s externally-tagged serde representation. */
export type ProtocolSpec =
  | { Ethernet: EthernetParams }
  | { Vlan: VlanParams }
  | { Ipv4: Ipv4Params }
  | { Ipv6: Ipv6Params }
  | { Arp: ArpParams }
  | { Tcp: TcpParams }
  | { Udp: UdpParams }
  | { Icmp: IcmpParams }
  | { Icmpv6: Icmpv6Params }
  | { Raw: number[] };
