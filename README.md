<p align="center">
  <img src="clawzien-logo.png" alt="Clawizen Logo" width="300">
</p>

# Clawizen — The Minimum Viable GenLayer Citizen

The cheapest possible way to participate in the [GenLayer](https://genlayer.com) ecosystem. A 54 KB C runtime, a private key, and a set of markdown skill files — running on a Raspberry Pi Zero powered by a solar panel, or [in your browser](#browser-runtime).

---

## Why

GenLayer is building an on-chain economy where AI agents are first-class participants. Agents debate, review code, earn rewards, and resolve disputes. Outcomes are decided by **Optimistic Democracy** — multiple LLMs independently evaluate evidence and reach consensus.

Most agent frameworks are overengineered. Hundred-megabyte runtimes, deep dependency trees, cloud-first architectures. Clawizen asks: **what's the minimum?**

A static binary that reads a markdown file, calls an LLM, and executes shell commands. The shell is the integration layer. `cast` talks to Base. `molly-cli` talks to GenLayer. The LLM does the thinking. The skill file is the strategy.

The result: a sovereign citizen that runs on 512 MB of RAM and sunlight.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Raspberry Pi Zero 2W  (512 MB RAM, WiFi, <1.5W)│
│     — or any browser via CheerpX (WebVM) —      │
│                                                 │
│  SubZeroClaw (54 KB, 379 lines of C)            │
│  ┌────────────────────────────────────────────┐ │
│  │ 1. Read skill file (markdown)              │ │
│  │ 2. Send to LLM (any model via OpenRouter)  │ │
│  │ 3. LLM returns shell commands              │ │
│  │ 4. Execute via popen()                     │ │
│  │ 5. Feed output back to LLM                 │ │
│  │ 6. Loop until "DONE"                       │ │
│  └────────────────────────────────────────────┘ │
│           │                    │                │
│     cast (Base)          molly-cli (GenLayer)   │
│           │                    │                │
└───────────┼────────────────────┼────────────────┘
            │                    │
     ┌──────┴──────┐    ┌───────┴───────┐
     │  argue.fun  │    │   molly.fun   │
     │  mergeproof │    │ Internet Court│
     │   your      │    │   your        │
     │   protocol  │    │   protocol    │
     └─────────────┘    └───────────────┘
            │                    │
            └────────┬───────────┘
                     │
              GenLayer Validators
           (multi-LLM consensus)
```

Each skill is a markdown file that teaches the LLM what contracts to call, what arguments to make, and when to stop. Adding a new protocol means writing a new `.md` file — no code changes required.

## Integrated Protocols

| Protocol | Status | What the agent does |
|----------|--------|---------------------|
| [argue.fun](https://argue.fun) | Live | Debate markets on Base — stake, argue, claim |
| [molly.fun](https://molly.fun) | Live | Content campaigns on GenLayer — post, submit, earn |
| [mergeproof](https://mergeproof.com) | Coming soon | Staked code reviews — find bugs, attest quality |
| [Internet Court](https://internetcourt.org) | Coming soon | Agent dispute resolution — file, evidence, verdict |

**Want to add your GenLayer protocol?** See [CONTRIBUTING.md](CONTRIBUTING.md).

## Skills

Skills live in `skills/<protocol>/`. SubZeroClaw loads them into the LLM's system prompt. You switch skills with `./setup.sh --skill <protocol>/<name>`.

```
skills/
├── argue/
│   ├── debater.md       # Scan markets, analyze both sides, place profitable bets
│   ├── heartbeat.md     # Every 4h: claim winnings, resolve debates, check wallet
│   ├── reviewer.md      # Read-only: analyze argument quality across active debates
│   └── creator.md       # Create new debates, add bounties, place opening positions
├── molly/
│   ├── earner.md        # Browse campaigns, post to MoltBook, submit and track rewards
│   └── moltbook.md      # Social heartbeat: DMs, feed, comments, karma building
├── mergeproof/
│   └── hunter.md        # Review PRs, report bugs for bounties, attest code quality
└── court/
    └── litigant.md      # File disputes, submit evidence, receive AI jury verdicts
```

## Quick Start

```bash
git clone https://github.com/jmlago/clawizen.git
cd clawizen
./setup.sh
```

This installs dependencies, builds SubZeroClaw, generates a wallet, registers on MoltBook, links your identity to molly.fun, and loads the default skill.

Then run:

```bash
# Switch skill and go
./setup.sh --skill argue/debater
./subzeroclaw/subzeroclaw "Scan active debates and place profitable bets"

./setup.sh --skill molly/earner
./subzeroclaw/subzeroclaw "Browse campaigns, create a post, and submit it"

# Run as a daemon
./subzeroclaw/watchdog ./subzeroclaw/subzeroclaw "Run argue.fun debater loop"
```

> `setup.sh --skill argue/debater` symlinks `skills/argue/debater.md` into `~/.subzeroclaw/skills/`. SubZeroClaw reads it as the system prompt. Your text argument kicks off the agentic loop.

## Deploy on Raspberry Pi (NixOS)

Everything becomes systemd services that start on boot and survive reboots. Heartbeats run on timers. Declarative.

```bash
./setup-nixos.sh
```

| Component | Notes |
|-----------|-------|
| SubZeroClaw | 54 KB static aarch64 binary, ~2 MB RAM |
| Total RAM | Agent + tools < 20 MB of the 512 MB available |
| Storage | ~200 MB on microSD |
| Power | < 1.5 W idle, solar panel friendly |

## Contract Addresses

See [`contracts/addresses.env`](contracts/addresses.env) for the full list. Key addresses:

| Protocol | Contract | Address |
|----------|----------|---------|
| argue.fun | Factory | `0x0692eC85325472Db274082165620829930f2c1F9` |
| argue.fun | $ARGUE | `0x7FFd8f91b0b1b5c7A2E6c7c9efB8Be0A71885b07` |
| molly.fun | CampaignFactory | `0x0F78AEd50d0BC19b97b7c2ba0e03ed583F9DD58E` |
| molly.fun | MoltBookID | `0xB32bf752d735576AE6f93AF27A529b240b3D4104` |

## Browser Runtime

The same SubZeroClaw C code runs in the browser via [CheerpX](https://cheerpx.io) — a real x86 Linux VM in WebAssembly. No shims, no compromises: real `bash`, real `jq`, real `grep`, real pipes and loops. The agent gets a full Debian environment.

- **SubZeroClaw** runs as a native i386 binary inside the VM
- **Shell commands** (jq, grep, sed, awk, sort, etc.) are real coreutils binaries
- **curl** is bridged through browser `fetch()` via a file-based IPC protocol
- **cast** (compute commands like `sig`, `keccak`) run natively; network commands bridge through viem in the browser
- **Filesystem** persists across sessions via IndexedDB (config, keys, skills survive page reloads)
- **Privy onboarding** — Google sign-in, auto-generated local wallet, card onramp via MoonPay

### Two onboarding paths

| Path | Flow |
|------|------|
| **Normie** | Google sign-in → auto-generated wallet → fund with card → run |
| **Hacker** | Paste your own private key in Settings → run |

Privy handles OAuth and the fiat onramp. The agent's private key is generated locally with viem and never leaves the browser.

### Getting started

```bash
cd web
cp .env.example .env       # fill in API key, optionally Privy App ID
npm install
./build-image.sh            # builds Debian i386 ext2 image (requires Docker + e2fsprogs)
npm run dev                 # http://localhost:5173
```

The landing page is at `/`, the app is at `/app/`. Pick a skill, type a prompt, and click Run. The agent loop executes entirely in the browser — no server, no backend. Click "Advanced" in the terminal header for a raw Linux shell.

### File structure

```
web/
├── index.html              # Landing page
├── app/
│   └── index.html          # App (terminal, skills, settings)
├── Dockerfile.cheerpx      # Debian i386 image with subzeroclaw + tools
├── build-image.sh          # Docker → ext2 image pipeline
├── vm-scripts/
│   ├── curl-bridge.sh      # curl replacement (file-based IPC → browser fetch)
│   └── cast-bridge.sh      # cast wrapper (compute → native, network → bridge)
├── src/
│   ├── main.ts             # Boot CheerpX VM → bridge → run agent
│   ├── cheerpx.ts          # CheerpX lifecycle (boot, run, filesystem)
│   ├── bridge.ts           # Browser-side IPC (polls VM for HTTP/cast requests)
│   ├── cast-browser.ts     # cast commands via viem (used by bridge for network ops)
│   ├── terminal.ts         # xterm.js (filtered agent output + raw Advanced mode)
│   ├── config.ts           # Settings lifecycle (localStorage + VM filesystem)
│   ├── privy.ts            # Privy SDK wrapper (Google OAuth, onramp)
│   ├── wallet.ts           # Local wallet management (viem, localStorage)
│   ├── editor.ts           # Markdown editor
│   └── skills.ts           # Skill markdown loader
└── public/
    └── clawzien-vm.ext2    # VM disk image (gitignored, built by build-image.sh)
```

## Contributing

Clawizen is designed to grow with the GenLayer ecosystem. Adding a new protocol is as simple as writing a markdown skill file. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.
