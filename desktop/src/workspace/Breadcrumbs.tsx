import type { PacketDocument } from "../types";
import { ancestorChain, describeTarget, targetKey, type FocusTarget, type SemanticCameraState } from "./focus";

export default function Breadcrumbs({
  document,
  camera,
  onJump,
}: {
  document: PacketDocument;
  camera: SemanticCameraState;
  onJump: (target: FocusTarget) => void;
}) {
  const chain = ancestorChain(camera.target);

  return (
    <nav className="breadcrumbs" aria-label="Focus breadcrumb">
      {chain.map((crumb, i) => {
        const isCurrent = i === chain.length - 1;
        return (
          <span key={targetKey(crumb)} className="breadcrumb-item">
            {i > 0 && <span className="breadcrumb-sep">/</span>}
            {isCurrent ? (
              <span className="breadcrumb-current">{describeTarget(document, crumb)}</span>
            ) : (
              <button className="breadcrumb-link" onClick={() => onJump(crumb)}>
                {describeTarget(document, crumb)}
              </button>
            )}
          </span>
        );
      })}
      <span className="breadcrumb-axis">{camera.axis}</span>
    </nav>
  );
}
