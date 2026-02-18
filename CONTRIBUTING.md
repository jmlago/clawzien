# Contributing to Clawizen

Clawizen is the minimum viable GenLayer citizen. It grows by adding skills for new protocols in the ecosystem. If your protocol runs on GenLayer or Base and has an agent-accessible interface, it can be integrated here.

## Adding a new protocol

### 1. Create the skill directory

```
skills/your-protocol/
```

### 2. Write a skill file

A skill is a markdown file that teaches an LLM how to interact with your protocol via shell commands. Look at the existing skills for reference:

- [`skills/argue/debater.md`](skills/argue/debater.md) — uses `cast` for on-chain reads/writes on Base
- [`skills/molly/earner.md`](skills/molly/earner.md) — uses `molly-cli` for GenLayer intelligent contracts + MoltBook API via `curl`

A good skill file has:

**Preflight checks** — Verify wallet, balances, identity, or whatever your protocol needs before the agent can act. If something is missing, tell the agent to STOP with a clear error.

**Contract addresses and session variables** — Hardcode addresses at the top. The agent sets them as shell variables at the start of every session.

**Workflow** — Numbered steps with exact shell commands. Use `cast call` for reads, `cast send` for writes (Base/EVM), or `curl` for REST APIs (GenLayer). Show the expected response format so the agent knows what to parse.

**Decision rules** — When should the agent act vs. wait? What are the risk limits? What's the strategy? The LLM follows these as guidelines.

**End condition** — Tell the agent when to reply "DONE". This signals SubZeroClaw that the task is complete.

### 3. Add contract addresses

Add your protocol's addresses to `contracts/addresses.env`:

```bash
# your-protocol (chain name, chain ID)
YOUR_PROTOCOL_CONTRACT=0x...
```

If your protocol has ABIs needed for `cast`, add them to `contracts/abis/`.

### 4. Add a NixOS service (optional)

If your skill should run as a daemon or on a timer, add it to `nix/configuration.nix` using the `mkClawService` helper:

```nix
systemd.services.clawizen-your-skill = mkClawService {
  name = "your-skill";
  description = "Clawizen — your protocol agent";
  skill = "your-protocol/skill-name.md";
  prompt = "What the agent should do";
};
```

For periodic tasks, add a timer:

```nix
systemd.timers.clawizen-your-skill = {
  wantedBy = [ "timers.target" ];
  timerConfig = { OnCalendar = "*-*-* 00/4:00:00"; Persistent = true; };
};
```

### 5. Test it

```bash
./setup.sh --skill your-protocol/skill-name
./subzeroclaw/subzeroclaw "Your task prompt here"
```

Watch the session log in `~/.subzeroclaw/logs/` to verify the agent follows the skill correctly.

### 6. Submit a PR

Include:
- The skill file(s) in `skills/your-protocol/`
- Updated `contracts/addresses.env` if you added addresses
- Any ABIs in `contracts/abis/` if needed
- Updated `nix/configuration.nix` if you added a service

## Improving existing skills

Found a bug? Better strategy? Missing edge case? PRs welcome. The skills were tested end-to-end but are young — real-world usage will expose gaps.

Common improvements:
- Better decision rules (when to act, risk limits)
- Error handling for contract reverts or API failures
- New workflow steps (e.g. a rebalancing step for the debater)
- Preflight checks for edge cases we haven't hit yet

## How SubZeroClaw works

Understanding the runtime helps write better skills.

- SubZeroClaw loads ALL `.md` files from `~/.subzeroclaw/skills/` into the system prompt
- `./setup.sh --skill <name>` ensures only ONE skill is loaded at a time
- The LLM's only tool is `shell` — it outputs shell commands, SubZeroClaw runs them via `popen()`, and feeds stdout back
- The agent loops until it says "DONE" or hits `max_turns` (default 200)
- Commands run in a basic shell environment — `PATH` must include any tools the skill needs (`cast`, `molly`, `curl`, `jq`)
- Session logs go to `~/.subzeroclaw/logs/<session-id>.txt` — every tool call and response is recorded

## Style guide

- Keep skills concise. The system prompt has a token budget — every line costs inference.
- Use exact shell commands, not pseudocode. The LLM copies them.
- Hardcode addresses. Don't make the agent look them up.
- One skill = one concern. Don't combine debating and content creation in one file.
- End with `Reply "DONE"` so the agent knows when to stop.

## Questions?

Open an issue. If you're building on GenLayer and want to integrate, we'd rather help you get it right than review a broken PR.
