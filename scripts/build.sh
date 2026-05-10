#!/usr/bin/env bash
set -euo pipefail

# ── Dioptase macOS Build Script ──────────────────────────────────────────────
# Produces a signed/unsigned DMG for macOS 14+.
#
# Usage:
#   ./scripts/build.sh           # unsigned dev build
#   ./scripts/build.sh --sign    # signed with Developer ID
#   ./scripts/build.sh --release # signed + notarized production build
#
# Prerequisites:
#   - macOS 14+
#   - Xcode Command Line Tools (or full Xcode)
#   - Node.js 18+ and pnpm
#   - Rust toolchain (rustup)
#   - [optional] Apple Developer ID for signing/notarization
# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$PROJECT_DIR/src-tauri/target/release/bundle"

DO_SIGN=false
DO_NOTARIZE=false

# ── Parse args ───────────────────────────────────────────────────────────────

for arg in "$@"; do
  case "$arg" in
    --sign)   DO_SIGN=true ;;
    --release) DO_SIGN=true; DO_NOTARIZE=true ;;
    --help|-h)
      echo "Usage: $0 [--sign | --release]"
      echo ""
      echo "  (no flag)    Unsigned dev build"
      echo "  --sign       Sign with Apple Developer ID (requires CODE_SIGN_IDENTITY env)"
      echo "  --release    Sign + notarize (requires APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# ── Pre-flight checks ────────────────────────────────────────────────────────

echo "==> Checking environment..."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: This script only runs on macOS." >&2
  exit 1
fi

MACOS_VER="$(sw_vers -productVersion)"
MAJOR_VER="${MACOS_VER%%.*}"
if [[ "$MAJOR_VER" -lt 14 ]]; then
  echo "ERROR: macOS 14+ required. Detected: $MACOS_VER" >&2
  exit 1
fi
echo "    macOS $MACOS_VER ✓"

for cmd in node pnpm rustc cargo; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Please install it first." >&2
    exit 1
  fi
  echo "    $cmd ✓"
done

if [[ "$DO_SIGN" == true ]]; then
  IDENTITY="${CODE_SIGN_IDENTITY:-}"
  if [[ -z "$IDENTITY" ]]; then
    echo "ERROR: --sign requires CODE_SIGN_IDENTITY env var (e.g. 'Developer ID Application: ...')." >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
    echo "ERROR: Signing identity '$IDENTITY' not found in keychain." >&2
    exit 1
  fi
  echo "    Signing identity '$IDENTITY' ✓"
fi

if [[ "$DO_NOTARIZE" == true ]]; then
  for var in APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD; do
    if [[ -z "${!var:-}" ]]; then
      echo "ERROR: --release requires $var env var." >&2
      exit 1
    fi
  done
  echo "    Notarization credentials ✓"
fi

# ── Install dependencies ─────────────────────────────────────────────────────

echo ""
echo "==> Installing npm dependencies..."
cd "$PROJECT_DIR"
pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────────────────────

echo ""
echo "==> Building Dioptase..."
pnpm tauri build

# ── Sign (optional) ──────────────────────────────────────────────────────────

DMG_PATH="$BUNDLE_DIR/dmg/Dioptase_"*"_${ARCH:-aarch64}.dmg"
# Expand glob
DMG_PATH="$(echo $DMG_PATH)"

APP_PATH="$BUNDLE_DIR/macos/Dioptase.app"

if [[ "$DO_SIGN" == true ]]; then
  echo ""
  echo "==> Signing .app bundle..."
  codesign --deep --force --verify --verbose \
    --sign "$IDENTITY" \
    --options runtime \
    --entitlements "$PROJECT_DIR/scripts/entitlements.plist" \
    "$APP_PATH"

  echo "==> Signing .dmg..."
  codesign --force --verify --verbose \
    --sign "$IDENTITY" \
    "$DMG_PATH"
fi

# ── Notarize (optional) ─────────────────────────────────────────────────────

if [[ "$DO_NOTARIZE" == true ]]; then
  echo ""
  echo "==> Submitting for notarization..."
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait

  echo ""
  echo "==> Stapling notarization ticket..."
  xcrun stapler staple "$DMG_PATH"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════"
echo "  Build complete!"
echo "  DMG: $DMG_PATH"
echo "══════════════════════════════════════════════════════"
