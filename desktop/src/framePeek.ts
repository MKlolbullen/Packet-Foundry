// A shallow, pure-TS peek at an Ethernet frame — just enough to label a row in the .pcap frame
// list (protocol path + endpoints) without a full dissection per frame. This deliberately
// duplicates a sliver of the engine's protocol knowledge: a one-line heuristic for scanning a
// capture is a different job from `dissect()`'s authoritative, never-panic structural decode, and
// running the real dissector on every frame would mean an IPC round-trip apiece. Every read is
// length-gated, so a short or malformed frame yields a partial label rather than throwing.

const ETHERTYPE = { IPV4: 0x0800, IPV6: 0x86dd, ARP: 0x0806, VLAN: 0x8100, VLAN_QINQ: 0x88a8 };
const IPPROTO: Record<number, string> = { 1: "ICMP", 2: "IGMP", 6: "TCP", 17: "UDP", 58: "ICMPv6" };
const DNS_PORT = 53;

export interface FrameSummary {
  /** Protocol path, e.g. `IPv4/TCP`, `VLAN/IPv6/UDP/DNS`, `ARP`, or `0x88cc` for an unknown type. */
  label: string;
  /** Endpoints when known, e.g. `10.0.0.1:53124 → 10.0.0.2:443`; empty when not applicable. */
  info: string;
}

function be16(d: Uint8Array, o: number): number {
  return (d[o] << 8) | d[o + 1];
}

function ipv4(d: Uint8Array, o: number): string {
  return `${d[o]}.${d[o + 1]}.${d[o + 2]}.${d[o + 3]}`;
}

/** Compact (`::`-collapsed) IPv6 for a label. Display-only — no round-trip guarantee. */
function ipv6(d: Uint8Array, o: number): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(be16(d, o + i));
  // Find the longest run of zero groups to collapse (leftmost on a tie), per RFC 5952.
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (runStart < 0) runStart = i;
      runLen++;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }
  if (bestLen < 2) return groups.map((g) => g.toString(16)).join(":");
  const head = groups.slice(0, bestStart).map((g) => g.toString(16)).join(":");
  const tail = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(":");
  return `${head}::${tail}`;
}

function protoName(proto: number): string {
  return IPPROTO[proto] ?? `proto ${proto}`;
}

/** Summarize the L3/L4 shape of an IP packet whose header starts at `o`. `parts` already holds any
 * outer path (e.g. `["VLAN"]`); the IP layer name and transport name are appended. */
function ipSummary(parts: string[], name: string, d: Uint8Array, o: number, v6: boolean): FrameSummary {
  parts.push(name);
  const minHdr = v6 ? 40 : 20;
  if (o + minHdr > d.length) return { label: parts.join("/"), info: "" };

  let proto: number;
  let src: string;
  let dst: string;
  let l4: number;
  if (v6) {
    proto = d[o + 6];
    src = ipv6(d, o + 8);
    dst = ipv6(d, o + 24);
    l4 = o + 40; // extension headers not walked — a shallow peek
  } else {
    const ihl = (d[o] & 0x0f) * 4;
    proto = d[o + 9];
    src = ipv4(d, o + 12);
    dst = ipv4(d, o + 16);
    l4 = o + ihl;
  }

  parts.push(protoName(proto));
  let info = `${src} → ${dst}`;
  if ((proto === 6 || proto === 17) && l4 + 4 <= d.length) {
    const sp = be16(d, l4);
    const dp = be16(d, l4 + 2);
    info = `${src}:${sp} → ${dst}:${dp}`;
    if (sp === DNS_PORT || dp === DNS_PORT) parts[parts.length - 1] += "/DNS";
  }
  return { label: parts.join("/"), info };
}

/** Peek at a frame's protocol path and endpoints for a one-line list label. */
export function summarizeFrame(data: Uint8Array): FrameSummary {
  if (data.length < 14) return { label: "Ethernet", info: "truncated" };
  const parts: string[] = [];
  let et = be16(data, 12);
  let l3 = 14;
  if (et === ETHERTYPE.VLAN || et === ETHERTYPE.VLAN_QINQ) {
    parts.push("VLAN");
    if (data.length < 18) return { label: "VLAN", info: "" };
    et = be16(data, 16);
    l3 = 18;
  }

  switch (et) {
    case ETHERTYPE.ARP:
      parts.push("ARP");
      return { label: parts.join("/"), info: "" };
    case ETHERTYPE.IPV4:
      return ipSummary(parts, "IPv4", data, l3, false);
    case ETHERTYPE.IPV6:
      return ipSummary(parts, "IPv6", data, l3, true);
    default:
      parts.push(`0x${et.toString(16).padStart(4, "0")}`);
      return { label: parts.join("/"), info: "" };
  }
}
