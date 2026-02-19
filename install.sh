#!/bin/bash
set -e

cd "$(dirname "$0")"

# Detect platform and arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

BINARY_DIR="packages/opencode/dist/opencode-${OS}-${ARCH}/bin"
INSTALL_DIR="${HOME}/.local/bin"

echo "Building opencode for ${OS}-${ARCH}..."
bun install
bun run --cwd packages/opencode build --single

if [ ! -f "${BINARY_DIR}/opencode" ]; then
  echo "Build failed — binary not found at ${BINARY_DIR}/opencode"
  exit 1
fi

mkdir -p "$INSTALL_DIR"
ln -sf "$(pwd)/${BINARY_DIR}/opencode" "${INSTALL_DIR}/opencode"
echo "Installed: ${INSTALL_DIR}/opencode"

# Check if ~/.local/bin is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^${INSTALL_DIR}$"; then
  echo ""
  echo "Add ~/.local/bin to your PATH by adding this to your shell config:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
