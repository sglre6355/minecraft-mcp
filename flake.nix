{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      git-hooks,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        pre-commit = git-hooks.lib.${system}.run {
          src = ./.;
          hooks = {
            nixfmt.enable = true;
            oxfmt.enable = true;
            oxlint.enable = true;
            tsc = {
              enable = true;
              entry = "${pkgs.typescript}/bin/tsc";
              types_or = [
                "ts"
                "tsx"
              ];
              pass_filenames = false;
            };
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages =
            with pkgs;
            [
              bun
              typescript
              oxlint
              oxfmt
            ]
            ++ pre-commit.enabledPackages;

          shellHook = pre-commit.shellHook;
        };
      }
    );
}
