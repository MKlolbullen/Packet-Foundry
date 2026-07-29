import type { ComponentType } from "react";
import type { PacketDocument } from "../types";
import type { FocusTarget, Selection } from "./focus";
import PacketOverview from "./projections/PacketOverview";
import LayerFieldMap from "./projections/LayerFieldMap";
import FieldDetail from "./projections/FieldDetail";

export interface ProjectionProps<T extends FocusTarget> {
  document: PacketDocument;
  focus: T;
  selection?: Selection;
  onDive: (target: FocusTarget) => void;
  onSelect: (selection: Selection) => void;
}

type Registry = {
  [K in FocusTarget["kind"]]?: ComponentType<ProjectionProps<Extract<FocusTarget, { kind: K }>>>;
};

const REGISTRY: Registry = {
  packet: PacketOverview,
  layer: LayerFieldMap,
  field: FieldDetail,
};

function NotYetAvailable({ focus }: { focus: FocusTarget }) {
  return (
    <div className="projection-fallback">
      <p className="hint">“{focus.kind}” isn’t part of this view yet.</p>
    </div>
  );
}

export default function SemanticStage(props: ProjectionProps<FocusTarget>) {
  const Projection = (REGISTRY[props.focus.kind] as ComponentType<ProjectionProps<FocusTarget>> | undefined) ??
    NotYetAvailable;
  return <Projection {...props} />;
}
