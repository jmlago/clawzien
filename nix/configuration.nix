{ config, pkgs, ... }:

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

  # Debater — scans markets, places bets (daemon)
  systemd.services.clawizen-debater = {
    description = "Clawizen Debater — argue.fun autonomous agent";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    wantedBy = [ "multi-user.target" ];

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/argue/debater.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # Heartbeat — claims winnings, resolves expired debates (timer)
  systemd.services.clawizen-heartbeat = {
    description = "Clawizen Heartbeat — argue.fun periodic check-in";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "oneshot";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/argue/heartbeat.md";
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
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

  # Earner — browses campaigns, submits content (disabled by default)
  systemd.services.clawizen-earner = {
    description = "Clawizen Earner — molly.fun campaign agent";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    enable = false;

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/molly/earner.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # ── mergeproof ─────────────────────────────────────

  # Hunter — reviews PRs, finds bugs (disabled by default)
  systemd.services.clawizen-hunter = {
    description = "Clawizen Hunter — mergeproof code reviewer";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    enable = false;

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/mergeproof/hunter.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # ── Internet Court ─────────────────────────────────

  # Litigant — files disputes, submits evidence (disabled by default)
  systemd.services.clawizen-litigant = {
    description = "Clawizen Litigant — Internet Court dispute agent";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    enable = false;

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/court/litigant.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # SSH access
  services.openssh.enable = true;

  # Auto-upgrade (optional — pulls latest config on reboot)
  system.autoUpgrade.enable = false;

  system.stateVersion = "24.11";
}
