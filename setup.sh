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

# 2. Add SubZeroClaw as submodule
if [ ! -d "subzeroclaw" ]; then
    echo "Adding SubZeroClaw submodule..."
    git submodule add https://github.com/jmlago/subzeroclaw.git subzeroclaw
    git submodule update --init --recursive
fi

# 3. Build SubZeroClaw (static, works on Pi Zero)
echo "Building SubZeroClaw..."
cd subzeroclaw && make && cd ..

# 4. Create wallet (if not exists)
if [ ! -f "$HOME/.clawizen/private-key" ]; then
    echo "Generating new wallet..."
    mkdir -p "$HOME/.clawizen"
    cast wallet new --json > "$HOME/.clawizen/wallet.json"
    jq -r '.private_key' "$HOME/.clawizen/wallet.json" > "$HOME/.clawizen/private-key"
    echo "Wallet created! Address: $(jq -r '.address' "$HOME/.clawizen/wallet.json")"
    echo "Fund this address on GenLayer Testnet faucet: https://genlayer-faucet.vercel.app"
fi

# 5. Create symlink for skills
mkdir -p "$HOME/.subzeroclaw/skills"
ln -sf "$(pwd)/skills"/* "$HOME/.subzeroclaw/skills/"

echo ""
echo "Clawizen is ready!"
echo ""
echo "Next steps:"
echo "1. Fund your address: $(jq -r '.address' "$HOME/.clawizen/wallet.json")"
echo "2. Fill contracts/addresses.env with real addresses"
echo "3. Run: watchdog ./subzeroclaw/subzeroclaw skills/debater.md"
echo ""
echo "You are now a sovereign citizen of the Court of the Internet."
