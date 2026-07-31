import { describe, expect, it } from "vitest";
import { summarizeFrame } from "./framePeek";

// --- frame builders --------------------------------------------------------------------------

function eth(etherType: number, payload: number[], vlanInner?: number): number[] {
  const dstMac = [0, 0, 0, 0, 0, 0];
  const srcMac = [0, 0, 0, 0, 0, 0];
  if (vlanInner !== undefined) {
    return [...dstMac, ...srcMac, 0x81, 0x00, 0x00, 0x00, (vlanInner >> 8) & 0xff, vlanInner & 0xff, ...payload];
  }
  return [...dstMac, ...srcMac, (etherType >> 8) & 0xff, etherType & 0xff, ...payload];
}

// IPv4 header (20 bytes, IHL 5) + optional L4 ports.
function ipv4(proto: number, src: number[], dst: number[], l4: number[] = []): number[] {
  return [0x45, 0, 0, 0, 0, 0, 0, 0, 64, proto, 0, 0, ...src, ...dst, ...l4];
}
function ports(sp: number, dp: number): number[] {
  return [(sp >> 8) & 0xff, sp & 0xff, (dp >> 8) & 0xff, dp & 0xff];
}
// IPv6 header (40 bytes) + optional L4 ports.
function ipv6(nextHeader: number, src: number[], dst: number[], l4: number[] = []): number[] {
  return [0x60, 0, 0, 0, 0, 0, nextHeader, 64, ...src, ...dst, ...l4];
}

const IP_A = [192, 168, 1, 10];
const IP_B = [192, 168, 1, 20];
const V6_A = [0x20, 0x01, 0x0d, 0xb8, ...new Array(11).fill(0), 1];
const V6_B = [0x20, 0x01, 0x0d, 0xb8, ...new Array(11).fill(0), 2];

describe("summarizeFrame", () => {
  it("labels an IPv4/TCP frame with endpoints and ports", () => {
    const frame = new Uint8Array(eth(0x0800, ipv4(6, IP_A, IP_B, ports(53124, 443))));
    expect(summarizeFrame(frame)).toEqual({ label: "IPv4/TCP", info: "192.168.1.10:53124 → 192.168.1.20:443" });
  });

  it("tags DNS when a UDP port is 53", () => {
    const frame = new Uint8Array(eth(0x0800, ipv4(17, IP_A, IP_B, ports(53124, 53))));
    expect(summarizeFrame(frame)).toEqual({ label: "IPv4/UDP/DNS", info: "192.168.1.10:53124 → 192.168.1.20:53" });
  });

  it("labels ICMP without ports", () => {
    const frame = new Uint8Array(eth(0x0800, ipv4(1, IP_A, IP_B)));
    expect(summarizeFrame(frame)).toEqual({ label: "IPv4/ICMP", info: "192.168.1.10 → 192.168.1.20" });
  });

  it("labels an ARP frame", () => {
    const frame = new Uint8Array(eth(0x0806, new Array(28).fill(0)));
    expect(summarizeFrame(frame)).toEqual({ label: "ARP", info: "" });
  });

  it("labels IPv6/TCP with compressed addresses", () => {
    const frame = new Uint8Array(eth(0x86dd, ipv6(6, V6_A, V6_B, ports(1234, 80))));
    expect(summarizeFrame(frame)).toEqual({ label: "IPv6/TCP", info: "2001:db8::1:1234 → 2001:db8::2:80" });
  });

  it("prefixes a VLAN tag and reads the inner ethertype", () => {
    const frame = new Uint8Array(eth(0, ipv4(6, IP_A, IP_B, ports(1, 2)), 0x0800));
    expect(summarizeFrame(frame)).toEqual({ label: "VLAN/IPv4/TCP", info: "192.168.1.10:1 → 192.168.1.20:2" });
  });

  it("falls back to the raw ethertype for an unknown protocol", () => {
    const frame = new Uint8Array(eth(0x88cc, new Array(10).fill(0))); // LLDP
    expect(summarizeFrame(frame)).toEqual({ label: "0x88cc", info: "" });
  });

  it("degrades gracefully on a too-short frame", () => {
    expect(summarizeFrame(new Uint8Array([0, 1, 2]))).toEqual({ label: "Ethernet", info: "truncated" });
  });

  it("names an unmapped IP protocol number", () => {
    const frame = new Uint8Array(eth(0x0800, ipv4(89, IP_A, IP_B))); // OSPF
    expect(summarizeFrame(frame)).toEqual({ label: "IPv4/proto 89", info: "192.168.1.10 → 192.168.1.20" });
  });
});
