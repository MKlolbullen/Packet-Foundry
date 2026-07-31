import { describe, expect, it } from "vitest";
import type { PacketDocument } from "../types";
import { INITIAL_VARIANT_STATE, variantById, variantsReducer, type VariantState } from "./variants";

function doc(buffer: string): PacketDocument {
  return { version: 1, buffer, layers: [], diagnostics: [] };
}

/** A store with three saved variants (v1 base/active, v2, v3). */
function threeVariants(): VariantState {
  let s = INITIAL_VARIANT_STATE;
  s = variantsReducer(s, { type: "SAVE", id: "v1", label: "Base", doc: doc("aa") });
  s = variantsReducer(s, { type: "SAVE", id: "v2", label: "TTL=1", doc: doc("bb") });
  s = variantsReducer(s, { type: "SAVE", id: "v3", label: "bad csum", doc: doc("cc") });
  return s;
}

describe("variantsReducer SAVE", () => {
  it("first save becomes both base and active", () => {
    const s = variantsReducer(INITIAL_VARIANT_STATE, { type: "SAVE", id: "v1", label: "Base", doc: doc("aa") });
    expect(s.items.map((v) => v.id)).toEqual(["v1"]);
    expect(s.baseId).toBe("v1");
    expect(s.activeId).toBe("v1");
  });

  it("a later save appends and becomes active, base unchanged", () => {
    const s = variantsReducer(threeVariants(), { type: "SAVE", id: "v4", label: "x", doc: doc("dd") });
    expect(s.items.map((v) => v.id)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(s.baseId).toBe("v1");
    expect(s.activeId).toBe("v4");
  });
});

describe("variantsReducer SELECT / RENAME / SET_BASE / UPDATE", () => {
  it("SELECT sets activeId; unknown or same id is a no-op (same reference)", () => {
    const s = threeVariants();
    expect(variantsReducer(s, { type: "SELECT", id: "v2" }).activeId).toBe("v2");
    expect(variantsReducer(s, { type: "SELECT", id: "nope" })).toBe(s);
    const active = variantsReducer(s, { type: "SELECT", id: "v2" });
    expect(variantsReducer(active, { type: "SELECT", id: "v2" })).toBe(active);
  });

  it("RENAME changes the label; unknown id / unchanged label is a no-op", () => {
    const s = threeVariants();
    expect(variantById(variantsReducer(s, { type: "RENAME", id: "v2", label: "new" }), "v2")!.label).toBe("new");
    expect(variantsReducer(s, { type: "RENAME", id: "nope", label: "x" })).toBe(s);
    expect(variantsReducer(s, { type: "RENAME", id: "v2", label: "TTL=1" })).toBe(s);
  });

  it("SET_BASE reassigns the base; unknown or same id is a no-op", () => {
    const s = threeVariants();
    expect(variantsReducer(s, { type: "SET_BASE", id: "v2" }).baseId).toBe("v2");
    expect(variantsReducer(s, { type: "SET_BASE", id: "nope" })).toBe(s);
    expect(variantsReducer(s, { type: "SET_BASE", id: "v1" })).toBe(s);
  });

  it("UPDATE overwrites a variant's doc; unknown id is a no-op", () => {
    const s = threeVariants();
    const updated = variantsReducer(s, { type: "UPDATE", id: "v2", doc: doc("ff") });
    expect(variantById(updated, "v2")!.doc.buffer).toBe("ff");
    expect(variantsReducer(s, { type: "UPDATE", id: "nope", doc: doc("ff") })).toBe(s);
  });
});

describe("variantsReducer DELETE", () => {
  it("deleting a non-active, non-base variant leaves base/active", () => {
    const s = variantsReducer(threeVariants(), { type: "SELECT", id: "v2" }); // active v2, base v1
    const d = variantsReducer(s, { type: "DELETE", id: "v3" });
    expect(d.items.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(d.baseId).toBe("v1");
    expect(d.activeId).toBe("v2");
  });

  it("deleting the active variant nulls activeId, keeps base and others", () => {
    const s = variantsReducer(threeVariants(), { type: "SELECT", id: "v3" }); // active v3
    const d = variantsReducer(s, { type: "DELETE", id: "v3" });
    expect(d.activeId).toBeNull();
    expect(d.baseId).toBe("v1");
    expect(d.items.map((v) => v.id)).toEqual(["v1", "v2"]);
  });

  it("deleting the base reassigns base to the first remaining variant", () => {
    const d = variantsReducer(threeVariants(), { type: "DELETE", id: "v1" });
    expect(d.baseId).toBe("v2");
  });

  it("deleting the only/last variant resets to empty", () => {
    let s = variantsReducer(INITIAL_VARIANT_STATE, { type: "SAVE", id: "v1", label: "x", doc: doc("aa") });
    s = variantsReducer(s, { type: "DELETE", id: "v1" });
    expect(s).toEqual({ items: [], baseId: null, activeId: null });
  });

  it("deleting an unknown id is a no-op (same reference)", () => {
    const s = threeVariants();
    expect(variantsReducer(s, { type: "DELETE", id: "nope" })).toBe(s);
  });
});
