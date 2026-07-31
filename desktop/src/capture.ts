// Capture-file dispatcher: sniff the leading magic and hand off to the classic-pcap or pcapng
// reader. Both return the same `PcapCapture`, so callers (the workbench's Open-capture mode) stay
// format-agnostic.

import { parsePcap, type PcapCapture } from "./pcap";
import { isPcapng, parsePcapng } from "./pcapng";

/** Parse a capture file, auto-detecting classic `.pcap` vs block-structured `.pcapng`. Throws only
 * when the bytes are neither format (each reader rejects its own bad magic); a truncated but
 * otherwise valid file returns the frames read so far. */
export function parseCapture(bytes: Uint8Array): PcapCapture {
  return isPcapng(bytes) ? parsePcapng(bytes) : parsePcap(bytes);
}
