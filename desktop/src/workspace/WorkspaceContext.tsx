import { createContext, useContext, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type { BitRange } from "../types";
import {
  type FocusAxis,
  type FocusTarget,
  INITIAL_FOCUS_STATE,
  type SemanticCameraState,
  focusReducer,
} from "./focus";

interface WorkspaceApi {
  camera: SemanticCameraState;
  dive: (target: FocusTarget) => void;
  rise: () => void;
  jump: (target: FocusTarget) => void;
  back: () => void;
  forward: () => void;
  setAxis: (axis: FocusAxis) => void;
  selectRange: (range?: BitRange) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

// Deliberately holds no `doc` — camera/focus state has no dependency on which document is
// loaded. `Workspace.tsx` owns `doc` separately and passes it down explicitly to consumers, so
// this context stays trivially testable and document-mutation state (a later PR) doesn't have to
// be untangled from navigation state later.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [camera, dispatch] = useReducer(focusReducer, INITIAL_FOCUS_STATE);

  const api = useMemo<WorkspaceApi>(
    () => ({
      camera,
      dive: (target) => dispatch({ type: "DIVE", target }),
      rise: () => dispatch({ type: "RISE" }),
      jump: (target) => dispatch({ type: "JUMP", target }),
      back: () => dispatch({ type: "BACK" }),
      forward: () => dispatch({ type: "FORWARD" }),
      setAxis: (axis) => dispatch({ type: "SET_AXIS", axis }),
      selectRange: (range) => dispatch({ type: "SELECT_RANGE", range }),
    }),
    [camera],
  );

  return <WorkspaceContext.Provider value={api}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
