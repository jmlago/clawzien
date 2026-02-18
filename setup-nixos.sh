#!/bin/bash
set -e

echo "Setting up Clawizen on NixOS — Minimum Viable Citizen"

# 1. Clone if not already in repo
if [ ! -f "flake.nix" ]; then
    echo "Cloning Clawizen..."
    git clone https://github.com/jmlago/clawizen.git
    cd clawizen
fi

# 2. Init submodules
echo "Initializing SubZeroClaw submodule..."
git submodule update --init --recursive

# 3. Build SubZeroClaw
echo "Building SubZeroClaw..."
cd subzeroclaw && make && cd ..

# 4. Create wallet if needed
if [ ! -f "/var/lib/clawizen/.privkey" ]; then
    echo "Generating wallet..."
    sudo mkdir -p /var/lib/clawizen

    WALLET_OUTPUT=$(nix-shell -p foundry-bin --run "cast wallet new")
    PRIVATE_KEY=$(echo "$WALLET_OUTPUT" | grep "Private key:" | awk '{print $3}')
    ADDRESS=$(echo "$WALLET_OUTPUT" | grep "Address:" | awk '{print $2}')

    echo "$PRIVATE_KEY" | sudo tee /var/lib/clawizen/.privkey > /dev/null
    sudo chmod 600 /var/lib/clawizen/.privkey
    echo "{\"address\": \"$ADDRESS\"}" | sudo tee /var/lib/clawizen/wallet.json > /dev/null

    echo "Wallet created: $ADDRESS"
    echo "Fund it on Base (argue.fun) and GenLayer (molly.fun)"
fi

# 5. Deploy files
echo "Deploying skills and binary..."
sudo cp -r skills /var/lib/clawizen/
sudo cp -r contracts /var/lib/clawizen/
sudo mkdir -p /var/lib/clawizen/subzeroclaw
sudo cp subzeroclaw/subzeroclaw /var/lib/clawizen/subzeroclaw/

# 6. Copy NixOS config and rebuild
echo "Applying NixOS configuration..."
sudo cp nix/configuration.nix /etc/nixos/clawizen.nix

echo ""
echo "Now add this to your /etc/nixos/configuration.nix imports:"
echo "  imports = [ ./clawizen.nix ];"
echo ""
echo "Then run: sudo nixos-rebuild switch"
echo ""
echo "Or if using flakes:"
echo "  sudo nixos-rebuild switch --flake .#clawizen"
echo ""
echo "Services:"
echo "  clawizen-debater   — argue.fun debater (enabled, auto-starts)"
echo "  clawizen-heartbeat — argue.fun heartbeat (timer, every 4 hours)"
echo "  clawizen-earner    — molly.fun earner (disabled, enable in config)"
echo "  clawizen-hunter    — mergeproof reviewer (disabled)"
echo "  clawizen-litigant  — Internet Court (disabled)"
echo ""
echo "Check status: systemctl status clawizen-debater"
