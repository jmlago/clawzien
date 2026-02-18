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
fi

# Ensure cast is in PATH for SubZeroClaw's popen()
mkdir -p "$HOME/.local/bin"
if [ -f "$HOME/.foundry/bin/cast" ]; then
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
    molly config set privateKey "$(cat "$HOME/.clawizen/.privkey")" 2>/dev/null || true
    molly config set identityAddress 0xB32bf752d735576AE6f93AF27A529b240b3D4104 2>/dev/null || true
    molly config set factoryAddress 0x0F78AEd50d0BC19b97b7c2ba0e03ed583F9DD58E 2>/dev/null || true
    molly config set network https://studio-dev.genlayer.com/api 2>/dev/null || true
fi

# 7. Register on MoltBook (if not registered)
if [ ! -f "$HOME/.clawizen/.moltbook_key" ]; then
    echo "Registering on MoltBook..."
    REGISTER_RESP=$(curl -s -X POST https://www.moltbook.com/api/v1/agents/register \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"clawzien\", \"description\": \"Sovereign AI citizen of the GenLayer ecosystem. Built on SubZeroClaw (54KB C runtime). Participates in argue.fun, molly.fun, mergeproof, and Internet Court.\"}")

    API_KEY=$(echo "$REGISTER_RESP" | jq -r '.agent.api_key // empty')
    CLAIM_URL=$(echo "$REGISTER_RESP" | jq -r '.agent.claim_url // empty')
    VERIFY_CODE=$(echo "$REGISTER_RESP" | jq -r '.agent.verification_code // empty')

    if [ -n "$API_KEY" ]; then
        echo -n "$API_KEY" > "$HOME/.clawizen/.moltbook_key"
        chmod 600 "$HOME/.clawizen/.moltbook_key"
        echo "MoltBook registered!"
        echo ""
        echo "  IMPORTANT: Your human must claim this agent:"
        echo "  $CLAIM_URL"
        echo ""
        echo "  Tweet: I'm claiming my AI agent \"clawzien\" on @moltbook"
        echo "  Verification: $VERIFY_CODE"
    else
        echo "MoltBook registration failed (name may be taken). Register manually:"
        echo "  curl -s -X POST https://www.moltbook.com/api/v1/agents/register \\"
        echo "    -H 'Content-Type: application/json' \\"
        echo "    -d '{\"name\": \"your-agent-name\", \"description\": \"...\"}'"
        echo "  Then save the api_key to ~/.clawizen/.moltbook_key"
    fi
fi

# 8. Link MoltBook identity to molly.fun (if not linked)
if command -v molly &> /dev/null && [ -f "$HOME/.clawizen/.moltbook_key" ]; then
    IDENTITY_CHECK=$(molly identity get-username "$ADDRESS" 2>/dev/null || echo '{}')
    USERNAME=$(echo "$IDENTITY_CHECK" | jq -r '.username // empty')

    if [ -z "$USERNAME" ] || [ "$USERNAME" = "null" ]; then
        echo "Linking MoltBook identity to molly.fun..."
        MOLTBOOK_KEY=$(cat "$HOME/.clawizen/.moltbook_key")

        # Get MoltBook username from profile
        MB_USERNAME=$(curl -s https://www.moltbook.com/api/v1/agents/me \
          -H "Authorization: Bearer $MOLTBOOK_KEY" | jq -r '.agent.name // empty')

        if [ -n "$MB_USERNAME" ]; then
            # Start identity link
            LINK_RESP=$(molly identity link-start "$MB_USERNAME" 2>/dev/null || echo '{}')
            TOKEN=$(echo "$LINK_RESP" | jq -r '.token.token // empty')

            if [ -n "$TOKEN" ]; then
                # Put token in MoltBook profile
                curl -s -X PATCH https://www.moltbook.com/api/v1/agents/me \
                  -H "Authorization: Bearer $MOLTBOOK_KEY" \
                  -H "Content-Type: application/json" \
                  -d "{\"description\": \"Sovereign AI citizen of the GenLayer ecosystem. Built on SubZeroClaw (54KB C runtime).\n\nmolly-verification: $TOKEN\"}" > /dev/null

                # Complete the link
                molly identity link-complete "$MB_USERNAME" 2>/dev/null && \
                    echo "Identity linked: $MB_USERNAME -> $ADDRESS" || \
                    echo "Identity link failed — may need manual completion"
            fi
        fi
    else
        echo "MoltBook identity already linked: $USERNAME"
    fi
fi

# 9. Load default skill (debater)
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
