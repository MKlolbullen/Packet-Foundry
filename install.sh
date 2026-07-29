#!/usr/bin/env bash
# Packet Foundry one-command setup: installs every prerequisite (Rust toolchain, Node.js, and —
# on Linux — the Tauri system libraries), then builds the CLI and the desktop frontend.
#
#   ./install.sh              everything above
#   ./install.sh --bundle     ...plus a full desktop app bundle (cargo tauri build — slow)
#   ./install.sh --dry-run    print what would run without changing anything
#
# Safe to re-run: every step checks before it installs. Uses sudo only for system packages,
# and only when not already root.

set -euo pipefail

BUNDLE=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --bundle) BUNDLE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

BOLD=$'\033[1m'; BLUE=$'\033[34m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
step()  { printf '%s\n' "${BOLD}${BLUE}==>${RESET}${BOLD} $*${RESET}"; }
ok()    { printf '%s\n' "    ${GREEN}✓${RESET} $*"; }
note()  { printf '%s\n' "    ${YELLOW}·${RESET} $*"; }

run() {
  if [ "$DRY" = 1 ]; then
    note "[dry-run] $*"
  else
    "$@"
  fi
}

# Everything is relative to the repo root, wherever the script is invoked from.
cd "$(dirname "$0")"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

OS="$(uname -s)"

# ---------------------------------------------------------------- system deps
step "System dependencies"
case "$OS" in
  Linux)
    # Tauri v2's Linux prerequisites (webkit2gtk 4.1 et al.) plus the usual build tools.
    # https://v2.tauri.app/start/prerequisites/
    if command -v apt-get >/dev/null 2>&1; then
      run $SUDO apt-get update
      run $SUDO apt-get install -y \
        build-essential curl wget file pkg-config libssl-dev \
        libwebkit2gtk-4.1-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
      ok "apt packages present"
    elif command -v dnf >/dev/null 2>&1; then
      run $SUDO dnf install -y \
        gcc gcc-c++ make curl wget file pkgconf-pkg-config openssl-devel \
        webkit2gtk4.1-devel libxdo-devel libappindicator-gtk3-devel librsvg2-devel
      ok "dnf packages present"
    elif command -v pacman >/dev/null 2>&1; then
      run $SUDO pacman -Syu --needed --noconfirm \
        base-devel curl wget file openssl webkit2gtk-4.1 xdotool libappindicator-gtk3 librsvg
      ok "pacman packages present"
    else
      note "unrecognized Linux package manager — install the Tauri v2 prerequisites manually:"
      note "https://v2.tauri.app/start/prerequisites/  (then re-run this script)"
    fi
    ;;
  Darwin)
    # macOS ships WebKit; Xcode's command line tools cover the compilers.
    if ! xcode-select -p >/dev/null 2>&1; then
      run xcode-select --install
      note "accept the Command Line Tools install, then re-run this script if it stopped"
    else
      ok "Xcode command line tools present"
    fi
    ;;
  *)
    note "unsupported OS ($OS) — on Windows, use WSL2 or install the Tauri v2 prerequisites"
    note "manually: https://v2.tauri.app/start/prerequisites/"
    ;;
esac

# ----------------------------------------------------------------------- rust
step "Rust toolchain"
if command -v cargo >/dev/null 2>&1; then
  ok "cargo $(cargo --version | cut -d' ' -f2) already installed"
else
  note "installing rustup (stable toolchain)"
  if [ "$DRY" = 1 ]; then
    note "[dry-run] curl rustup.rs | sh -s -- -y"
  else
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    . "$HOME/.cargo/env"
  fi
fi
# The workspace uses edition 2024 — needs a recent stable.
if [ "$DRY" = 0 ] && command -v rustup >/dev/null 2>&1; then
  run rustup update stable >/dev/null 2>&1 || true
fi

# ----------------------------------------------------------------------- node
step "Node.js"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "node $(node --version) already installed"
    NEED_NODE=0
  else
    note "node $(node --version) is too old (need >= 20)"
  fi
fi
if [ "$NEED_NODE" = 1 ]; then
  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        if [ "$DRY" = 1 ]; then
          note "[dry-run] NodeSource setup_22.x + apt-get install nodejs"
        else
          curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash -
          $SUDO apt-get install -y nodejs
        fi
      elif command -v dnf >/dev/null 2>&1; then
        run $SUDO dnf install -y nodejs
      elif command -v pacman >/dev/null 2>&1; then
        run $SUDO pacman -S --needed --noconfirm nodejs npm
      else
        note "install Node.js >= 20 manually (https://nodejs.org), then re-run"
        exit 1
      fi
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        run brew install node
      else
        note "install Homebrew (https://brew.sh) or Node.js >= 20 manually, then re-run"
        exit 1
      fi
      ;;
  esac

  # Don't trust that the package manager actually delivered >= 20 — distro repos (and an
  # already-configured NodeSource for a different major) can still ship an older Node. Re-check
  # and stop rather than let the frontend build fail later with a confusing error.
  if [ "$DRY" = 0 ]; then
    if ! command -v node >/dev/null 2>&1; then
      note "Node.js still isn't on PATH after the install step — install it manually (https://nodejs.org, >= 20) and re-run"
      exit 1
    fi
    NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
    if [ "$NODE_MAJOR" -lt 20 ]; then
      note "installed Node.js $(node --version) is older than 20 — your package manager's repo ships an outdated Node"
      note "install Node.js >= 20 manually (https://nodejs.org) or via nvm/asdf, then re-run"
      exit 1
    fi
    ok "node $(node --version) installed"
  fi
fi

# ---------------------------------------------------------------------- build
step "Build: packet-foundry CLI (release)"
run cargo build --release -p packet-cli
[ "$DRY" = 1 ] || ok "target/release/packet-foundry"

step "Build: desktop frontend"
run bash -c "cd desktop && npm install"
run bash -c "cd desktop && npm run build"
[ "$DRY" = 1 ] || ok "desktop/dist"

if [ "$BUNDLE" = 1 ]; then
  step "Bundle: desktop app (cargo tauri build — this takes a while)"
  run bash -c "cd desktop && npm run tauri build"
  [ "$DRY" = 1 ] || ok "desktop/src-tauri/target/release/bundle"
fi

# -------------------------------------------------------------------- wrap-up
step "Done"
cat <<SUMMARY
    CLI:      ./target/release/packet-foundry --help
    Desktop:  cd desktop && npm run tauri dev      (hot-reloading dev app)
$( [ "$BUNDLE" = 1 ] || printf '    Bundle:   ./install.sh --bundle                (installable desktop app)' )
    Tests:    cargo test --workspace && (cd desktop && npm test)
SUMMARY
