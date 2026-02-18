{ config, pkgs, ... }:

let
  # SubZeroClaw loads all .md files from $HOME/.subzeroclaw/skills/ into the
  # system prompt. Each service gets its own HOME so it loads only its own skill.
  # The text prompt passed as argv[1] kicks off the agentic loop.

  mkClawService = { name, description, skill, prompt, enabled ? false, type ? "simple" }: {
    inherit description;
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    ${if enabled then "wantedBy" else null} = [ "multi-user.target" ];
    ${if !enabled then "enable" else null} = false;

    environment = {
      HOME = "/var/lib/clawizen/homes/${name}";
    };

    serviceConfig = {
      Type = type;
      ExecStartPre = pkgs.writeShellScript "clawizen-${name}-prep" ''
        mkdir -p /var/lib/clawizen/homes/${name}/.subzeroclaw/skills
        mkdir -p /var/lib/clawizen/homes/${name}/.clawizen
        rm -f /var/lib/clawizen/homes/${name}/.subzeroclaw/skills/*.md
        ln -sf /var/lib/clawizen/skills/${skill} /var/lib/clawizen/homes/${name}/.subzeroclaw/skills/skill.md
        # Share wallet, config, and MoltBook key
        ln -sf /var/lib/clawizen/.privkey /var/lib/clawizen/homes/${name}/.clawizen/.privkey 2>/dev/null || true
        ln -sf /var/lib/clawizen/wallet.json /var/lib/clawizen/homes/${name}/.clawizen/wallet.json 2>/dev/null || true
        ln -sf /var/lib/clawizen/.moltbook_key /var/lib/clawizen/homes/${name}/.clawizen/.moltbook_key 2>/dev/null || true
        ln -sf /var/lib/clawizen/.subzeroclaw/config /var/lib/clawizen/homes/${name}/.subzeroclaw/config 2>/dev/null || true
      '';
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw \"${prompt}\"";
      Restart = if type == "simple" then "always" else "no";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };
in
{
  # System basics
  networking.hostName = "clawizen";
  networking.wireless.enable = true;
  time.timeZone = "UTC";

  # Minimal system packages
  environment.systemPackages = with pkgs; [
    foundry-bin
    nodejs
    jq
    curl
    git
  ];

  # ── argue.fun ──────────────────────────────────────

  systemd.services.clawizen-debater = mkClawService {
    name = "debater";
    description = "Clawizen Debater — argue.fun autonomous agent";
    skill = "argue/debater.md";
    prompt = "Scan active debates on argue.fun and place profitable bets. Loop continuously.";
    enabled = true;
  };

  systemd.services.clawizen-heartbeat = mkClawService {
    name = "heartbeat";
    description = "Clawizen Heartbeat — argue.fun periodic check-in";
    skill = "argue/heartbeat.md";
    prompt = "Run the 4-hour heartbeat routine: check balances, claim winnings, resolve expired debates, scan opportunities.";
    type = "oneshot";
  };

  systemd.timers.clawizen-heartbeat = {
    description = "Run Clawizen heartbeat every 4 hours";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "*-*-* 00/4:00:00";
      Persistent = true;
    };
  };

  # ── molly.fun ──────────────────────────────────────

  systemd.services.clawizen-earner = mkClawService {
    name = "earner";
    description = "Clawizen Earner — molly.fun campaign agent";
    skill = "molly/earner.md";
    prompt = "Browse active molly.fun campaigns, create a MoltBook post, submit it, and track rewards.";
  };

  systemd.services.clawizen-moltbook = mkClawService {
    name = "moltbook";
    description = "Clawizen MoltBook — social presence heartbeat";
    skill = "molly/moltbook.md";
    prompt = "Run the MoltBook social heartbeat: check DMs, browse feed, engage with posts, build karma.";
    type = "oneshot";
  };

  systemd.timers.clawizen-moltbook = {
    description = "Run MoltBook social heartbeat every 30 minutes";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "*-*-* *:00/30:00";
      Persistent = true;
    };
  };

  # ── mergeproof ─────────────────────────────────────

  systemd.services.clawizen-hunter = mkClawService {
    name = "hunter";
    description = "Clawizen Hunter — mergeproof code reviewer";
    skill = "mergeproof/hunter.md";
    prompt = "Review open mergeproof bounties, find bugs, and attest code quality.";
  };

  # ── Internet Court ─────────────────────────────────

  systemd.services.clawizen-litigant = mkClawService {
    name = "litigant";
    description = "Clawizen Litigant — Internet Court dispute agent";
    skill = "court/litigant.md";
    prompt = "Check for active disputes, file cases, submit evidence, and collect verdicts.";
  };

  # SSH access
  services.openssh.enable = true;

  system.autoUpgrade.enable = false;
  system.stateVersion = "24.11";
}
