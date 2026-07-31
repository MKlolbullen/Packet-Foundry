// Mirrors the JSON shapes serde produces for packet-core / protocol-engine types.
// See crates/packet-core/src/{bitrange,node,diagnostics,document}.rs and
// crates/protocol-engine/src/registry.rs for the Rust source of truth.

export interface BitRange {
  start_bit: number;
  len_bits: number;
}

export type FieldKind = "uint" | "bytes" | "mac_addr" | "ipv4_addr" | "flags";

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

/** Mirrors `ProtocolSpec`'s externally-tagged serde representation. */
export type ProtocolSpec =
  | { Ethernet: EthernetParams }
  | { Ipv4: Ipv4Params }
  | { Ipv6: Ipv6Params }
  | { Arp: ArpParams }
  | { Tcp: TcpParams }
  | { Udp: UdpParams }
  | { Icmp: IcmpParams }
  | { Raw: number[] };
