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
if [ ! -f "/var/lib/clawizen/private-key" ]; then
    echo "Generating wallet..."
    sudo mkdir -p /var/lib/clawizen
    nix-shell -p foundry-bin --run "cast wallet new --json" | sudo tee /var/lib/clawizen/wallet.json > /dev/null
    sudo jq -r '.private_key' /var/lib/clawizen/wallet.json | sudo tee /var/lib/clawizen/private-key > /dev/null
    echo "Wallet created! Address: $(sudo jq -r '.address' /var/lib/clawizen/wallet.json)"
    echo "Fund it: https://genlayer-faucet.vercel.app"
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
echo "Clawizen will start automatically as a systemd service."
echo "Check status: systemctl status clawizen-debater"
