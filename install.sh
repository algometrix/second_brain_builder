#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# AI Explainer — Obsidian Plugin Installer (macOS / Linux)
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COUNT=0

# =============================================================
# Build
# =============================================================

echo
echo "[1/2] Building plugin..."
echo

cd "$SCRIPT_DIR"

if [ ! -d "node_modules" ]; then
    npm install
fi

npm run build

echo
echo "Build complete."
echo

# =============================================================
# Auto-detect vaults from Obsidian config
# =============================================================

echo "[2/2] Installing into vaults..."
echo

install_vault() {
    local VAULT="$1"

    if [ ! -d "$VAULT/.obsidian" ]; then
        echo "  SKIP: $VAULT — .obsidian folder missing"
        return
    fi

    local DEST="$VAULT/.obsidian/plugins/ai-explainer"
    mkdir -p "$DEST"

    cp "$SCRIPT_DIR/main.js"       "$DEST/main.js"
    cp "$SCRIPT_DIR/manifest.json" "$DEST/manifest.json"
    cp "$SCRIPT_DIR/styles.css"    "$DEST/styles.css"

    echo "  OK: $VAULT"
    COUNT=$((COUNT + 1))
}

ask_for_vault() {
    echo "Enter your Obsidian vault path (or press Enter to skip):"
    echo "Example: /Users/you/Documents/MyVault"
    echo
    read -rp "Vault path: " USER_VAULT

    if [ -z "$USER_VAULT" ]; then
        return
    fi

    if [ ! -d "$USER_VAULT" ]; then
        echo "  ERROR: Folder does not exist: $USER_VAULT"
        echo
        ask_for_vault
        return
    fi

    if [ ! -d "$USER_VAULT/.obsidian" ]; then
        echo "  WARNING: No .obsidian folder found. This may not be a vault."
        read -rp "  Install anyway? (y/n): " CONFIRM
        if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
            echo "  Skipped."
            echo
            ask_for_vault
            return
        fi
    fi

    install_vault "$USER_VAULT"

    echo
    read -rp "Add another vault? (y/n): " MORE
    if [ "$MORE" = "y" ] || [ "$MORE" = "Y" ]; then
        echo
        ask_for_vault
    fi
}

# Try to find obsidian.json
OBS_CONFIG=""
if [ -f "$HOME/Library/Application Support/obsidian/obsidian.json" ]; then
    OBS_CONFIG="$HOME/Library/Application Support/obsidian/obsidian.json"
elif [ -f "$HOME/.config/obsidian/obsidian.json" ]; then
    OBS_CONFIG="$HOME/.config/obsidian/obsidian.json"
fi

if [ -n "$OBS_CONFIG" ]; then
    echo "Detected Obsidian config at $OBS_CONFIG"
    echo "Scanning for vaults..."
    echo

    if command -v python3 &>/dev/null; then
        while IFS= read -r VAULT; do
            if [ -n "$VAULT" ]; then
                install_vault "$VAULT"
            fi
        done < <(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for v in data.get('vaults', {}).values():
    p = v.get('path', '')
    if p:
        print(p)
" "$OBS_CONFIG" 2>/dev/null || true)
    elif command -v jq &>/dev/null; then
        while IFS= read -r VAULT; do
            if [ -n "$VAULT" ]; then
                install_vault "$VAULT"
            fi
        done < <(jq -r '.vaults | to_entries[] | .value.path' "$OBS_CONFIG" 2>/dev/null || true)
    else
        echo "  Could not parse config (install jq or python3 for auto-detection)."
    fi
fi

if [ "$COUNT" -eq 0 ]; then
    echo "No vaults detected automatically."
    echo
    ask_for_vault
fi

echo
if [ "$COUNT" -eq 0 ]; then
    echo "No vaults were installed."
else
    echo "Installed into $COUNT vault(s)."
    echo "Restart Obsidian or enable the plugin in Settings > Community plugins."
fi
