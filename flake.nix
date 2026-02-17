{
  description = "Clawizen — Minimum Viable Citizen on NixOS";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: let
    system = "aarch64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    nixosConfigurations.clawizen = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [
        ./nix/hardware-pi-zero-2w.nix
        ./nix/configuration.nix
      ];
    };

    packages.${system}.subzeroclaw = pkgs.stdenv.mkDerivation {
      pname = "subzeroclaw";
      version = "0.1.0";
      src = ./subzeroclaw;
      buildPhase = "make";
      installPhase = ''
        mkdir -p $out/bin
        cp subzeroclaw $out/bin/
      '';
    };
  };
}
