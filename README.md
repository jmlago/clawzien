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
│          — or any browser via WASM —            │
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

The same SubZeroClaw C code runs in the browser — zero changes to the runtime. Emscripten compiles it to WASM, and a custom `popen()` override routes calls at link time:

- **LLM API calls** (curl) → browser `fetch()`
- **Shell commands** (cast, molly-cli, jq) → [WebContainers](https://webcontainers.io) (Node.js in the browser)
- **cast** → replaced by a viem-based shim (~200 lines)

```bash
cd web
npm install
./build-wasm.sh    # requires emscripten (emsdk)
npm run dev        # http://localhost:5173
```

Fill in your OpenRouter API key, pick a skill, type a prompt, and click Run. The agent loop executes entirely in the browser — no server, no backend.

```
web/
├── build-wasm.sh          # emcc compiles subzeroclaw → WASM
├── src/
│   ├── library_popen.js   # popen()/pclose() override (the entire bridge)
│   ├── main.ts            # Boot: WebContainers → WASM → wire together
│   ├── webcontainer.ts    # Shell execution runtime
│   └── shims/
│       ├── cast.ts        # viem-based Foundry cast replacement
│       ├── curl.ts        # fetch-based curl
│       └── jq.ts          # Minimal jq
└── public/                # WASM build output (gitignored)
```

## Contributing

Clawizen is designed to grow with the GenLayer ecosystem. Adding a new protocol is as simple as writing a markdown skill file. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.
