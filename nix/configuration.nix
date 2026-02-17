{ config, pkgs, ... }:

{
  # System basics
  networking.hostName = "clawizen";
  networking.wireless.enable = true;
  time.timeZone = "UTC";

  # Minimal system packages
  environment.systemPackages = with pkgs; [
    foundry-bin
    jq
    curl
    git
  ];

  # Clawizen debater service — runs forever, restarts on failure
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
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/debater.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # Clawizen reviewer service (disabled by default)
  systemd.services.clawizen-reviewer = {
    description = "Clawizen Reviewer — mergeproof autonomous agent";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    enable = false;

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/reviewer.md";
      Restart = "always";
      RestartSec = 10;
      DynamicUser = true;
      StateDirectory = "clawizen";
      WorkingDirectory = "/var/lib/clawizen";
    };
  };

  # Clawizen litigant service (disabled by default)
  systemd.services.clawizen-litigant = {
    description = "Clawizen Litigant — internetcourt autonomous agent";
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    enable = false;

    environment = {
      HOME = "/var/lib/clawizen";
    };

    serviceConfig = {
      Type = "simple";
      ExecStart = "/var/lib/clawizen/subzeroclaw/subzeroclaw /var/lib/clawizen/skills/litigant.md";
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
