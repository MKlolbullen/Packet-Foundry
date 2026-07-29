import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatFieldValue, hexToBytes, locationString, readBytesRange } from "../../packet";
import { bytesToHex } from "../../hex";
import type { BitRange, PacketDocument } from "../../types";
import type { ProjectionProps } from "../SemanticStage";
import { findField, type FocusTarget } from "../focus";
import {
  hasStructuredEditor,
  parseStructuredValue,
  structuredDraftFor,
  structuredErrorMessage,
  structuredPlaceholder,
} from "../fieldEdit";

type FieldFocus = Extract<FocusTarget, { kind: "field" }>;

/** The inclusive-exclusive byte span a bit range touches, rounded out to whole bytes — a
 * sub-byte field (e.g. a 4-bit Version field) still touches one whole byte shared with a
 * sibling, which is fine here: this is "here are the raw bytes this field's range spans," not a
 * claim about which bits within them are this field's own. */
function byteSpanOf(range: BitRange): { startByte: number; endByte: number } {
  return {
    startByte: Math.floor(range.start_bit / 8),
    endByte: Math.ceil((range.start_bit + range.len_bits) / 8),
  };
}

/** The field's current bytes, hex-encoded — for seeding/resetting the edit draft. Empty string if
 * the buffer is malformed or the range is out of bounds (the draft input just starts blank). */
function draftBytesFor(doc: PacketDocument, range: BitRange): string {
  const bytes = hexToBytes(doc.buffer);
  const fieldBytes = bytes ? readBytesRange(bytes, range.start_bit, range.len_bits) : null;
  return fieldBytes ? bytesToHex(fieldBytes) : "";
}

// Byte-aligned fields can be pinned to an explicit value from here — either a typed "Structured"
// editor (per FieldKind, e.g. dotted-decimal for ipv4_addr) or raw hex. Sub-byte fields stay
// fully read-only until bit-level editing exists.
export default function FieldDetail({
  document,
  focus,
  onDive,
  onSelect,
  onDocumentChange,
}: ProjectionProps<FieldFocus>) {
  const field = findField(document, focus.layerId, focus.fieldId);

  // Arriving at a field via dive auto-highlights its range elsewhere (hex rail, diagnostics)
  // without requiring an extra click.
  useEffect(() => {
    if (field) onSelect({ source: focus, range: field.range });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId]);

  const [draftHex, setDraftHex] = useState("");
  const [structuredDraft, setStructuredDraft] = useState("");
  const [editMode, setEditMode] = useState<"structured" | "raw">("structured");
  const [pending, setPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Re-syncs both drafts on a focus change (a different field) *and* on a document swap for the
  // same field — the latter matters because undo/redo replaces `document` out from under an open
  // editor without going through afterMutation, which is the only other place these get updated.
  useEffect(() => {
    setEditError(null);
    setDraftHex(field ? draftBytesFor(document, field.range) : "");
    setStructuredDraft(field ? structuredDraftFor(document, field) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId, document]);

  // Deliberately a *separate* effect, keyed only on the field (not `document`): which editor mode
  // is showing is a per-field UI preference, not a value — an unrelated undo/redo on this same
  // field shouldn't silently flip a user's manual "Raw" choice back to "Structured".
  useEffect(() => {
    setEditMode(field && hasStructuredEditor(field.kind) ? "structured" : "raw");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.layerId, focus.fieldId]);

  if (!field) {
    return <p className="hint">This field is no longer present — the stack was re-assembled.</p>;
  }

  const bytes = hexToBytes(document.buffer);
  const value = bytes ? formatFieldValue(bytes, field) : "<malformed buffer>";
  const state = field.override_bytes ? "pinned" : field.derivation ? "derived" : "plain";
  const { startByte, endByte } = byteSpanOf(field.range);
  const ownerId = `${focus.layerId}:${focus.fieldId}`;
  const byteAligned = field.range.start_bit % 8 === 0 && field.range.len_bits % 8 === 0;
  const expectedByteLen = field.range.len_bits / 8;
  const fieldKind = field.kind;

  async function afterMutation(result: PacketDocument) {
    onDocumentChange(result);
    const updated = findField(result, focus.layerId, focus.fieldId);
    setDraftHex(updated ? draftBytesFor(result, updated.range) : "");
    setStructuredDraft(updated ? structuredDraftFor(result, updated) : "");
  }

  // Shared by both editors: bytes have already been validated (and are exactly the field's
  // expected length) by the caller — this just re-serializes to hex (never forwards raw user
  // text — hexToBytes tolerates internal whitespace but Rust's hex::decode doesn't) and invokes.
  async function commitBytes(bytes: Uint8Array) {
    setPending(true);
    setEditError(null);
    try {
      const result = await invoke<PacketDocument>("set_field_bytes", {
        document,
        layerId: Number(focus.layerId),
        fieldId: Number(focus.fieldId),
        bytesHex: bytesToHex(bytes),
      });
      await afterMutation(result);
    } catch (e) {
      setEditError(String(e));
    } finally {
      setPending(false);
    }
  }

  async function setBytes() {
    const parsed = hexToBytes(draftHex);
    if (!parsed) {
      setEditError("Not valid hex.");
      return;
    }
    if (parsed.length !== expectedByteLen) {
      setEditError(`Expected ${expectedByteLen} byte${expectedByteLen === 1 ? "" : "s"}, got ${parsed.length}.`);
      return;
    }
    await commitBytes(parsed);
  }

  async function setStructuredValue() {
    const parsed = parseStructuredValue(fieldKind, structuredDraft, expectedByteLen);
    if (!parsed) {
      setEditError(structuredErrorMessage(fieldKind));
      return;
    }
    await commitBytes(parsed);
  }

  async function clearPin() {
    setPending(true);
    setEditError(null);
    try {
      const result = await invoke<PacketDocument>("clear_field_override", {
        document,
        layerId: Number(focus.layerId),
        fieldId: Number(focus.fieldId),
      });
      await afterMutation(result);
    } catch (e) {
      setEditError(String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <dl className="field-detail">
        <dt>Name</dt>
        <dd>{field.name}</dd>
        <dt>Range</dt>
        <dd className="loc">{locationString(field.range)}</dd>
        <dt>Kind</dt>
        <dd>{field.kind}</dd>
        <dt>Value</dt>
        <dd className="field-value">{value}</dd>
        <dt>State</dt>
        <dd>{state}</dd>
      </dl>

      <div className="field-bytes">
        <span className="field-bytes-label">Bytes</span>
        <div className="byte-chip-row">
          {Array.from({ length: endByte - startByte }, (_, i) => startByte + i).map((byteIndex) => (
            <button
              key={byteIndex}
              className="byte-chip"
              tabIndex={0}
              onClick={() => onSelect({ source: focus, range: { start_bit: byteIndex * 8, len_bits: 8 } })}
              onDoubleClick={() => onDive({ kind: "byte", byteIndex, ownerId })}
              onKeyDown={(e) => {
                if (e.key === "Enter") onDive({ kind: "byte", byteIndex, ownerId });
              }}
            >
              {byteIndex}
            </button>
          ))}
        </div>
      </div>

      <div className="field-edit">
        {byteAligned ? (
          <>
            {hasStructuredEditor(field.kind) && (
              <div className="edit-mode-toggle" role="radiogroup" aria-label="Edit mode">
                <button
                  className={editMode === "structured" ? "theme-option active" : "theme-option"}
                  aria-pressed={editMode === "structured"}
                  onClick={() => setEditMode("structured")}
                >
                  Structured
                </button>
                <button
                  className={editMode === "raw" ? "theme-option active" : "theme-option"}
                  aria-pressed={editMode === "raw"}
                  onClick={() => setEditMode("raw")}
                >
                  Raw
                </button>
              </div>
            )}
            {editMode === "structured" && hasStructuredEditor(field.kind) ? (
              <div className="row wrap">
                <input
                  className="box-input"
                  value={structuredDraft}
                  onChange={(e) => setStructuredDraft(e.currentTarget.value)}
                  placeholder={structuredPlaceholder(field.kind)}
                  spellCheck={false}
                  disabled={pending}
                />
                <button onClick={setStructuredValue} disabled={pending}>
                  Set value
                </button>
                {state === "pinned" && (
                  <button onClick={clearPin} disabled={pending}>
                    Clear pin
                  </button>
                )}
              </div>
            ) : (
              <div className="row wrap">
                <input
                  className="box-input hex-input"
                  value={draftHex}
                  onChange={(e) => setDraftHex(e.currentTarget.value)}
                  spellCheck={false}
                  disabled={pending}
                />
                <button onClick={setBytes} disabled={pending}>
                  Set bytes
                </button>
                {state === "pinned" && (
                  <button onClick={clearPin} disabled={pending}>
                    Clear pin
                  </button>
                )}
              </div>
            )}
            {editError && <p className="error">{editError}</p>}
          </>
        ) : (
          <p className="hint">Bit-level editing isn’t supported yet.</p>
        )}
      </div>

      {field.derivation && (
        <button
          className="view-derivation"
          onClick={() =>
            onDive({ kind: "operation", layerId: focus.layerId, fieldId: focus.fieldId, operationId: "root" })
          }
        >
          View derivation →
        </button>
      )}
    </>
  );
}
