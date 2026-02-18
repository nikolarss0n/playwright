#!/usr/bin/env bash
set -euo pipefail

# ── Config (change these if repos move) ──
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$SOURCE_DIR/plugin"
PLUGIN_JSON="$PLUGIN_DIR/.claude-plugin/plugin.json"
SERVER_TS="$SOURCE_DIR/packages/pw-test-writer/src/mcp/server.ts"
MARKETPLACE_DIR="$HOME/.claude/plugins/marketplaces/pw-autopilot"

# ── Parse args ──
BUMP="${1:-patch}"  # patch (default), minor, or major
COMMIT_MSG="${2:-}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major] [commit message]"
  echo "  patch (default): 0.3.1 → 0.3.2"
  echo "  minor:           0.3.1 → 0.4.0"
  echo "  major:           0.3.1 → 1.0.0"
  exit 1
fi

# ── Read current version ──
CURRENT=$(grep '"version"' "$PLUGIN_JSON" | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "Version: $CURRENT → $NEW_VERSION"

# ── Update version in plugin.json ──
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$PLUGIN_JSON"
echo "Updated $PLUGIN_JSON"

# ── Update version in server.ts ──
sed -i '' "s/version: '$CURRENT'/version: '$NEW_VERSION'/" "$SERVER_TS"
echo "Updated $SERVER_TS"

# ── Build ──
echo ""
echo "Building..."
bash "$PLUGIN_DIR/build.sh"

# ── Commit source repo ──
echo ""
if [[ -z "$COMMIT_MSG" ]]; then
  COMMIT_MSG="chore: bump plugin version to $NEW_VERSION"
fi

cd "$SOURCE_DIR"
git add "$PLUGIN_JSON" "$SERVER_TS" "$PLUGIN_DIR/server/mcp-server.js"
git commit -m "$COMMIT_MSG"
git push
echo "Pushed source repo"

# ── Sync to marketplace ──
echo ""
if [[ ! -d "$MARKETPLACE_DIR/plugin" ]]; then
  echo "ERROR: Marketplace dir not found at $MARKETPLACE_DIR"
  echo "Install the plugin first: claude plugins add pw-autopilot/playwright-autopilot"
  exit 1
fi

rsync -a --delete "$PLUGIN_DIR/" "$MARKETPLACE_DIR/plugin/"
cd "$MARKETPLACE_DIR"
git add -A

if git diff --cached --quiet; then
  echo "Marketplace already up to date"
else
  git commit -m "$COMMIT_MSG"
  git push
  echo "Pushed marketplace repo"
fi

echo ""
echo "Done! Plugin v$NEW_VERSION published."
echo "Users can update with: claude plugins update playwright-autopilot"
