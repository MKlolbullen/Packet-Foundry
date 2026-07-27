# Packet Foundry — desktop

The Tauri + React shell for Packet Foundry. `src-tauri` is a thin IPC boundary — `default_stack`,
`create_packet`, and `inspect_packet` just forward to the `packet-core`/`protocol-engine` crates in
`../crates`; no packet logic lives in this app. The frontend is a JSON-driven builder/inspector for
now (edit a `ProtocolSpec[]` stack, assemble it, inspect the resulting document); the drag-and-drop
box editor described in [`../docs/phase-1-design.md`](../docs/phase-1-design.md) is a later phase.

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
