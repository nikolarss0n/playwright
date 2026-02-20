#!/usr/bin/env bash
set -euo pipefail

# Publish plugin to the marketplace repo (nikolarss0n/playwright-autopilot).
# Usage: bash plugin/publish.sh [commit message]
#
# Prerequisites:
#   1. Build first:  bash plugin/build.sh
#   2. Commit & push to origin (nikolarss0n/playwright)
#   3. Run this script to sync plugin/ to the marketplace repo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKETPLACE_REPO="nikolarss0n/playwright-autopilot"

# Read version from plugin.json
VERSION=$(grep -o '"version": *"[^"]*"' "$SCRIPT_DIR/.claude-plugin/plugin.json" | grep -o '[0-9][0-9.]*')
DEFAULT_MSG="v${VERSION}: update plugin"
MSG="${1:-$DEFAULT_MSG}"

echo "Publishing playwright-autopilot v${VERSION} to ${MARKETPLACE_REPO}..."

# Clone marketplace repo to temp dir
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

gh repo clone "$MARKETPLACE_REPO" "$TEMP_DIR/marketplace" -- --depth 1 2>/dev/null

# Sync plugin/ directory and root README
rm -rf "$TEMP_DIR/marketplace/plugin"
cp -R "$SCRIPT_DIR" "$TEMP_DIR/marketplace/plugin"
cp "$REPO_ROOT/README.md" "$TEMP_DIR/marketplace/README.md"

# Remove build script and publish script from marketplace copy (not needed by users)
rm -f "$TEMP_DIR/marketplace/plugin/build.sh"
rm -f "$TEMP_DIR/marketplace/plugin/publish.sh"

# Commit and push
cd "$TEMP_DIR/marketplace"
git add -A

if git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

git commit -m "$MSG"
git push

echo "Done. Published v${VERSION} to https://github.com/${MARKETPLACE_REPO}"
