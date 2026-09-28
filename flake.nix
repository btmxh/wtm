{
  description = "wtm - oshi clip organizer (YouTube-only)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs
            pnpm
            sqlite
          ];

          shellHook = ''
            echo "wtm dev shell ready (node $(node --version), pnpm $(pnpm --version))"
          '';
        };
      });
}
