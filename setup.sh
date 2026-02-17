#!/bin/bash
set -e

echo "Setting up Clawizen — Minimum Viable Citizen"

# 1. Install Foundry (cast) if missing
if ! command -v cast &> /dev/null; then
    echo "Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash
    source ~/.bashrc
    foundryup
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

# 7. Create symlink for skills
mkdir -p "$HOME/.subzeroclaw/skills"
find "$(pwd)/skills" -name '*.md' -exec ln -sf {} "$HOME/.subzeroclaw/skills/" \;

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
echo "Run skills:"
echo "  ./subzeroclaw/subzeroclaw skills/argue/debater.md"
echo "  ./subzeroclaw/subzeroclaw skills/argue/heartbeat.md"
echo "  ./subzeroclaw/subzeroclaw skills/molly/earner.md"
echo "  ./subzeroclaw/watchdog ./subzeroclaw/subzeroclaw skills/argue/debater.md"
