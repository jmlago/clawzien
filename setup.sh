#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$HOME/.subzeroclaw/skills"

# ── Skill switching mode ─────────────────────────────
# Usage: ./setup.sh --skill argue/debater
if [ "$1" = "--skill" ] && [ -n "$2" ]; then
    SKILL_FILE="$SCRIPT_DIR/skills/$2.md"
    if [ ! -f "$SKILL_FILE" ]; then
        echo "Skill not found: $2"
        echo "Available skills:"
        find "$SCRIPT_DIR/skills" -name '*.md' | sed "s|$SCRIPT_DIR/skills/||;s|\.md$||" | sort
        exit 1
    fi
    mkdir -p "$SKILLS_DIR"
    rm -f "$SKILLS_DIR"/*.md
    ln -sf "$SKILL_FILE" "$SKILLS_DIR/$(basename "$SKILL_FILE")"
    echo "Skill loaded: $2 -> $SKILLS_DIR/$(basename "$SKILL_FILE")"
    exit 0
fi

# ── Full setup mode ──────────────────────────────────
echo "Setting up Clawizen — Minimum Viable Citizen"

# 1. Install Foundry (cast) if missing
if ! command -v cast &> /dev/null; then
    echo "Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash
    source ~/.bashrc
    foundryup
    # Symlink cast into PATH for SubZeroClaw's popen()
    mkdir -p "$HOME/.local/bin"
    ln -sf "$HOME/.foundry/bin/cast" "$HOME/.local/bin/cast"
fi

# 2. Install molly-cli if missing
if ! command -v molly &> /dev/null; then
    echo "Installing molly-cli..."
    npm install -g molly-cli
fi

# 3. Init submodule
if [ ! -f "subzeroclaw/Makefile" ]; then
    echo "Initializing SubZeroClaw submodule..."
    git submodule update --init --recursive
fi

# 4. Build SubZeroClaw (static, works on Pi Zero)
echo "Building SubZeroClaw..."
cd subzeroclaw && make && cd ..

# 5. Create wallet (if not exists)
if [ ! -f "$HOME/.clawizen/.privkey" ]; then
    echo "Generating new wallet..."
    mkdir -p "$HOME/.clawizen"

    WALLET_OUTPUT=$(cast wallet new)
    PRIVATE_KEY=$(echo "$WALLET_OUTPUT" | grep "Private key:" | awk '{print $3}')
    ADDRESS=$(echo "$WALLET_OUTPUT" | grep "Address:" | awk '{print $2}')

    echo "$PRIVATE_KEY" > "$HOME/.clawizen/.privkey"
    chmod 600 "$HOME/.clawizen/.privkey"
    echo "{\"address\": \"$ADDRESS\"}" > "$HOME/.clawizen/wallet.json"

    echo "Wallet created: $ADDRESS"
fi

ADDRESS=$(jq -r '.address' "$HOME/.clawizen/wallet.json")

# 6. Configure molly-cli
if command -v molly &> /dev/null; then
    molly config set identityAddress 0xB32bf752d735576AE6f93AF27A529b240b3D4104 2>/dev/null || true
    molly config set factoryAddress 0x0F78AEd50d0BC19b97b7c2ba0e03ed583F9DD58E 2>/dev/null || true
    molly config set network https://studio-dev.genlayer.com/api 2>/dev/null || true
fi

# 7. Load default skill (debater)
mkdir -p "$SKILLS_DIR"
rm -f "$SKILLS_DIR"/*.md
ln -sf "$SCRIPT_DIR/skills/argue/debater.md" "$SKILLS_DIR/debater.md"
echo "Default skill loaded: argue/debater"

echo ""
echo "Clawizen is ready!"
echo ""
echo "Your address: $ADDRESS"
echo ""
echo "Fund your wallet:"
echo "  argue.fun  — ETH + \$ARGUE on Base (chain ID 8453)"
echo "  molly.fun  — GEN tokens on GenLayer"
echo ""
echo "Then approve argue.fun Factory:"
echo "  cast send 0x7FFd8f91b0b1b5c7A2E6c7c9efB8Be0A71885b07 \"approve(address,uint256)\" 0x0692eC85325472Db274082165620829930f2c1F9 \$(cast max-uint) --private-key \$(cat ~/.clawizen/.privkey) --rpc-url https://mainnet.base.org"
echo ""
echo "Switch skills:    ./setup.sh --skill argue/heartbeat"
echo "Run the agent:    ./subzeroclaw/subzeroclaw \"Scan active debates and place profitable bets\""
echo "Run as daemon:    ./subzeroclaw/watchdog ./subzeroclaw/subzeroclaw \"Run argue.fun debater loop\""
echo ""
echo "Available skills:"
find "$SCRIPT_DIR/skills" -name '*.md' | sed "s|$SCRIPT_DIR/skills/||;s|\.md$||" | sort | sed 's/^/  /'
