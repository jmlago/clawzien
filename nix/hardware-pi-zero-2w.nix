{ config, lib, pkgs, ... }:

{
  # Raspberry Pi Zero 2W hardware configuration
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;

  # Kernel for aarch64
  boot.kernelPackages = pkgs.linuxPackages_rpi;

  # Hardware
  hardware.enableRedistributableFirmware = true;

  # File systems
  fileSystems."/" = {
    device = "/dev/disk/by-label/NIXOS_SD";
    fsType = "ext4";
  };

  # Swap (helpful with 512 MB RAM)
  swapDevices = [{
    device = "/swapfile";
    size = 512;
  }];

  # GPU memory split — give minimum to GPU, maximize for agent
  boot.kernelParams = [ "gpu_mem=16" ];
}
