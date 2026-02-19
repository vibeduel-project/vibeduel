# DOESNT WORK WELLj

# #!/bin/bash
# set -e

# cd "$(dirname "$0")"

# # Detect platform and arch
# OS=$(uname -s | tr '[:upper:]' '[:lower:]')
# ARCH=$(uname -m)
# case "$ARCH" in
#   x86_64) ARCH="x64" ;;
#   aarch64|arm64) ARCH="arm64" ;;
# esac

# BINARY_DIR="packages/opencode/dist/opencode-${OS}-${ARCH}/bin"
# INSTALL_DIR="${HOME}/.local/bin"

# # Ensure correct bun version
# REQUIRED_BUN=$(grep -o '"bun@[^"]*"' package.json | head -1 | sed 's/"bun@//' | sed 's/"//')
# CURRENT_BUN=$(bun --version 2>/dev/null || echo "none")
# if [ "$CURRENT_BUN" = "none" ]; then
#   echo "Bun is not installed. Installing bun@${REQUIRED_BUN}..."
#   curl -fsSL https://bun.sh/install | bash -s "bun-v${REQUIRED_BUN}"
#   export BUN_INSTALL="$HOME/.bun"
#   export PATH="$BUN_INSTALL/bin:$PATH"
# elif [ "$CURRENT_BUN" != "$REQUIRED_BUN" ]; then
#   echo "This project requires bun@${REQUIRED_BUN}, but you have bun@${CURRENT_BUN}."
#   echo "This will change your system-wide bun version."
#   printf "Proceed? [y/N] "
#   read -r REPLY
#   if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
#     curl -fsSL https://bun.sh/install | bash -s "bun-v${REQUIRED_BUN}"
#     export BUN_INSTALL="$HOME/.bun"
#     export PATH="$BUN_INSTALL/bin:$PATH"
#   else
#     echo "Aborted. Install bun@${REQUIRED_BUN} manually and re-run this script."
#     exit 1
#   fi
# fi

# echo "Building opencode for ${OS}-${ARCH}..."
# bun install
# bun run --cwd packages/opencode build --single

# if [ ! -f "${BINARY_DIR}/opencode" ]; then
#   echo "Build failed — binary not found at ${BINARY_DIR}/opencode"
#   exit 1
# fi

# mkdir -p "$INSTALL_DIR"
# ln -sf "$(pwd)/${BINARY_DIR}/opencode" "${INSTALL_DIR}/opencode"
# echo "Installed: ${INSTALL_DIR}/opencode"

# echo ""
# echo "Done! To use opencode, make sure ~/.local/bin is on your PATH:"
# echo '  export PATH="$HOME/.local/bin:$PATH"'
# echo ""
# echo "Then run: opencode"
