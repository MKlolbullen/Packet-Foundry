import { describe, expect, it } from "vitest";
import type { FieldChange, PacketDiff, PacketDocument } from "../types";
import { changeBadgeLabel, diffSummary, fieldRangeInDoc, hasChanges, stateTransitionLabel } from "./diffView";

const EMPTY_DIFF: PacketDiff = {
  layers: [{ name: "IPv4", status: "unchanged", fields_added: [], fields_removed: [], fields_changed: [] }],
  bytes: { changed: [], len_before: 20, len_after: 20 },
  diagnostics: { added: [], removed: [] },
};

describe("changeBadgeLabel / stateTransitionLabel", () => {
  it("labels each change kind", () => {
    expect(changeBadgeLabel("direct_edit")).toBe("direct");
    expect(changeBadgeLabel("derived_consequence")).toBe("consequence");
    expect(changeBadgeLabel("state_only")).toBe("state");
    expect(changeBadgeLabel("unchanged")).toBe("");
  });

  it("formats a state transition", () => {
    expect(stateTransitionLabel("plain", "pinned")).toBe("plain → pinned");
    expect(stateTransitionLabel("pinned", "derived")).toBe("pinned → derived");
  });
});

describe("hasChanges", () => {
  it("is false for an all-unchanged diff", () => {
    expect(hasChanges(EMPTY_DIFF)).toBe(false);
  });

  it("is true when a field changed", () => {
    const diff: PacketDiff = {
      ...EMPTY_DIFF,
      layers: [
        {
          name: "IPv4",
          status: "modified",
          fields_added: [],
          fields_removed: [],
          fields_changed: [
            {
              name: "TTL",
              kind: "uint",
              range_before: { start_bit: 176, len_bits: 8 },
              range_after: { start_bit: 176, len_bits: 8 },
              state_before: "plain",
              state_after: "pinned",
              value_before: "64",
              value_after: "1",
              change: "direct_edit",
            },
          ],
        },
      ],
    };
    expect(hasChanges(diff)).toBe(true);
  });

  it("is true when only bytes or only diagnostics changed", () => {
    expect(hasChanges({ ...EMPTY_DIFF, bytes: { changed: [{ start: 0, end: 1 }], len_before: 20, len_after: 20 } })).toBe(true);
    expect(
      hasChanges({
        ...EMPTY_DIFF,
        diagnostics: { added: [{ severity: "warning", code: "x", message: "m" }], removed: [] },
      }),
    ).toBe(true);
  });

  it("is true for an added or removed layer even with no field changes", () => {
    expect(
      hasChanges({ ...EMPTY_DIFF, layers: [{ name: "Payload", status: "added", fields_added: [], fields_removed: [], fields_changed: [] }] }),
    ).toBe(true);
  });
});

describe("diffSummary", () => {
  const fd = (name: string, change: FieldChange) => ({
    name,
    kind: "uint" as const,
    range_before: { start_bit: 0, len_bits: 8 },
    range_after: { start_bit: 0, len_bits: 8 },
    state_before: "plain" as const,
    state_after: "plain" as const,
    value_before: "0",
    value_after: "1",
    change,
  });

  it("is all-zero for an unchanged diff", () => {
    expect(diffSummary(EMPTY_DIFF)).toEqual({ direct: 0, consequence: 0, added: 0, removed: 0, total: 0 });
  });

  it("counts direct edits, consequences (incl. state-only), and added/removed layers + fields", () => {
    const diff: PacketDiff = {
      layers: [
        {
          name: "IPv4",
          status: "modified",
          fields_added: [],
          fields_removed: [{ name: "Opt", kind: "bytes", range: { start_bit: 0, len_bits: 8 }, state: "plain", value: "x" }],
          fields_changed: [fd("TTL", "direct_edit"), fd("Checksum", "derived_consequence"), fd("Flags", "state_only")],
        },
        { name: "Payload", status: "added", fields_added: [fd("Data", "direct_edit") as never], fields_removed: [], fields_changed: [] },
      ],
      bytes: { changed: [], len_before: 0, len_after: 0 },
      diagnostics: { added: [], removed: [] },
    };
    const s = diffSummary(diff);
    expect(s.direct).toBe(1);
    expect(s.consequence).toBe(2); // derived_consequence + state_only
    expect(s.added).toBe(2); // the added layer + its one added field
    expect(s.removed).toBe(1); // one removed field
    expect(s.total).toBe(6);
  });
});

describe("fieldRangeInDoc", () => {
  const doc: PacketDocument = {
    version: 1,
    buffer: "",
    layers: [
      {
        id: 1,
        name: "IPv4",
        range: { start_bit: 0, len_bits: 160 },
        fields: [{ id: 2, name: "TTL", range: { start_bit: 64, len_bits: 8 }, kind: "uint" }],
      },
    ],
    diagnostics: [],
  };

  it("finds a field's range by layer + field name", () => {
    expect(fieldRangeInDoc(doc, "IPv4", "TTL")).toEqual({ start_bit: 64, len_bits: 8 });
  });

  it("returns undefined for an absent layer or field", () => {
    expect(fieldRangeInDoc(doc, "TCP", "TTL")).toBeUndefined();
    expect(fieldRangeInDoc(doc, "IPv4", "Nope")).toBeUndefined();
  });
});
