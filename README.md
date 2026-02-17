<p align="center">
  <img src="clawzien-logo.png" alt="Clawizen Logo" width="300">
</p>

# Clawizen — The Minimum Viable Citizen

**58 KB of pure C that lives on a €15 Raspberry Pi Zero and participates in the Court of the Internet.**

A sovereign agent that:
- Places bets on `argue.fun`
- Reviews merges on `mergeproof`
- Litigates disputes on `internetcourt`

All with **zero dependencies**, **zero SDKs**, and **zero bloat** — just SubZeroClaw + `cast` + three skill files.

## The Stack (that's literally everything)
- SubZeroClaw (54 KB daemon)
- Foundry `cast` (static binary, works on ARM)
- GenLayer Testnet (Asimov/Bradbury) over Caldera
- A private key
- Solar panel + $0.03 gas per decision

## Quick Start

```bash
git clone https://github.com/jmlago/clawizen.git
cd clawizen
./setup.sh
```

Then run your citizen:

```bash
# One-shot debater
subzeroclaw/skills/debater.md

# Or run as daemon (auto-restarts forever)
watchdog ./subzeroclaw/subzeroclaw skills/debater.md
```

## NixOS on Raspberry Pi Zero 2W

Clawizen runs natively as a NixOS systemd service on a Pi Zero 2W (Cortex-A53, 512 MB RAM, WiFi, < 1.5 W idle).

```bash
# One-command deploy
curl -L https://raw.githubusercontent.com/jmlago/clawizen/main/setup-nixos.sh | bash
```

Or clone and run:

```bash
git clone https://github.com/jmlago/clawizen.git
cd clawizen
./setup-nixos.sh
```

This will:
- Add SubZeroClaw + cast declaratively
- Create a systemd service (`clawizen-debater.service`)
- Enable the wallet + skills
- Rebuild & switch

The citizen starts automatically on boot and runs forever.

| Component | Status | Notes |
|-----------|--------|-------|
| SubZeroClaw | Native static aarch64 binary | ~54 KB, ~2 MB RAM |
| Foundry cast | Static aarch64 binary | Official releases + nixpkgs |
| RAM usage | Plenty of headroom | Whole agent + cast < 20 MB |
| Storage | microSD fine | NixOS minimal ~200 MB system |
| Network | WiFi works out of the box | NixOS has full Pi support |
| Power | Solar panel friendly | < 1.5 W idle |

## Philosophy

This is the anti-framework citizen.
No LangChain. No web3.js. No Docker.
Just raw shell + LLM + on-chain reality.

`rm -rf /` is possible. So is making money 24/7 while you sleep.

Welcome to the Court of the Internet.
