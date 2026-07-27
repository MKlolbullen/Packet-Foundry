# Packet Foundry — desktop

The Tauri + React shell for Packet Foundry. `src-tauri` is a thin IPC boundary — `default_stack`,
`create_packet`, `inspect_packet`, and `evaluate_operation` just forward to the
`packet-core`/`protocol-engine` crates in `../crates`; no packet logic lives in this app.

Two tabs:
- **Build & Inspect** — edit a `ProtocolSpec[]` JSON stack, assemble it, inspect the resulting
  document (or a pasted one) and its diagnostics.
- **Box Editor** — the drag-and-drop `Operation` editor described in
  [`../docs/phase-1-design.md`](../docs/phase-1-design.md). Drag boxes from the palette onto a
  pannable/zoomable canvas (drag empty space to pan, scroll to zoom, or use the toolbar) to
  compose a tree, edit leaf parameters, and hit Evaluate to run it through the real engine against
  a scratch buffer. `Loop`/`If` render as Scratch-style C-blocks. The data model and tree edits
  (`src/operation.ts`) have a unit suite: `npm test`.

Both tabs stay mounted when you switch between them, so neither loses its draft. Theme
(System/Light/Dark) is in the header, top right.

## Develop

```sh
npm install
npm run tauri dev
```

## Build

```sh
npm run tauri build
```

Linux needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (`libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `librsvg2-dev`, etc.) installed system-wide first.
