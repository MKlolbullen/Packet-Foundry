import { useRef, useState } from "react";
import { hexToBytes } from "../packet";
import type { BitRange, Diagnostic, PacketDocument } from "../types";
import { fieldContainingBit, overlaps } from "./range-index";

type RailView = "hex" | "ascii" | "bits";

const VIEWS: { id: RailView; label: string }[] = [
  { id: "hex", label: "Hex" },
  { id: "ascii", label: "ASCII" },
  { id: "bits", label: "Bits" },
];

/** Printable ASCII (0x20–0x7E) as itself, everything else as a middle dot. */
function asciiOf(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "·";
}

// The authoritative byte buffer as a memory map, in three synchronized views (Hex / ASCII / Bits).
// Cross-highlighting is bidirectional: a field/layer selection highlights its bytes here, and
// clicking a byte (or, in Bits view, a single bit) selects its owning field — lighting it up in the
// layer diagram and inspector. Keyboard: Left/Right/Home/End move focus along the buffer, Enter
// selects the focused byte's owning field.
export default function HexBitRail({
  buffer,
  document,
  selectedRange,
  diagnostics,
  onSelectRange,
}: {
  buffer: string;
  document?: PacketDocument;
  selectedRange?: BitRange;
  diagnostics: Diagnostic[];
  onSelectRange: (range: BitRange) => void;
}) {
  const [view, setView] = useState<RailView>("hex");
  const [focused, setFocused] = useState(0);
  const cellRefs = useRef<(HTMLDivElement | null)[]>([]);

  const bytes = hexToBytes(buffer);
  if (bytes === null) {
    return <p className="error">Malformed buffer: `{buffer}` is not valid hex.</p>;
  }

  /** Select the field owning `bitIndex` (so it lights up in the diagram/inspector), or the raw
   * byte range when no field claims it. */
  function selectOwner(bitIndex: number) {
    const hit = document ? fieldContainingBit(document, bitIndex) : null;
    onSelectRange(hit ? hit.field.range : { start_bit: (bitIndex >> 3) * 8, len_bits: 8 });
  }

  function moveFocus(next: number) {
    const clamped = Math.max(0, Math.min(next, bytes!.length - 1));
    setFocused(clamped);
    cellRefs.current[clamped]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowRight":
        moveFocus(focused + 1);
        break;
      case "ArrowLeft":
        moveFocus(focused - 1);
        break;
      case "Home":
        moveFocus(0);
        break;
      case "End":
        moveFocus(bytes!.length - 1);
        break;
      case "Enter":
      case " ":
        selectOwner(focused * 8);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <div className="hex-bit-rail">
      <div className="hex-rail-toolbar">
        <div className="edit-mode-toggle" role="radiogroup" aria-label="Byte view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "theme-option active" : "theme-option"}
              aria-pressed={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="hex-rail-count">{bytes.length} bytes</span>
      </div>

      <div className={`hex-rail-cells hex-rail-${view}`} role="grid" aria-label="Packet bytes" onKeyDown={onKeyDown}>
        {Array.from(bytes).map((byte, i) => {
          const byteRange: BitRange = { start_bit: i * 8, len_bits: 8 };
          const selected = selectedRange ? overlaps(byteRange, selectedRange) : false;
          const diagnosed = diagnostics.some((d) => d.location && overlaps(byteRange, d.location));
          const classes = ["hex-byte"];
          if (selected) classes.push("hex-byte-selected");
          if (diagnosed) classes.push("hex-byte-diagnosed");

          return (
            <div
              key={i}
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              className={classes.join(" ")}
              role="gridcell"
              tabIndex={i === focused ? 0 : -1}
              title={`byte ${i} = 0x${byte.toString(16).padStart(2, "0")} (${byte})`}
              onFocus={() => setFocused(i)}
              onClick={() => selectOwner(i * 8)}
            >
              {view === "hex" && byte.toString(16).padStart(2, "0")}
              {view === "ascii" && <span className="hex-ascii-char">{asciiOf(byte)}</span>}
              {view === "bits" &&
                Array.from({ length: 8 }, (_, b) => {
                  const bit = (byte >> (7 - b)) & 1;
                  const bitSelected = selectedRange
                    ? overlaps({ start_bit: i * 8 + b, len_bits: 1 }, selectedRange)
                    : false;
                  return (
                    <span
                      key={b}
                      className={bitSelected ? "hex-bit hex-bit-selected" : "hex-bit"}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectOwner(i * 8 + b);
                      }}
                    >
                      {bit}
                    </span>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
