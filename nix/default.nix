# use ./nix/update.sh to install
#
# use <https://ahobson.github.io/nix-package-search> to find a package version

let
  pkgs = import <nixpkgs> {};
  inherit (pkgs) buildEnv;
in buildEnv {
  name = "ephemeral-env-packages";
  paths = [

    (import
      (builtins.fetchGit {
        # Descriptive name to make the store path easier to identify
        name = "awscli2-2.2.14";
        url = "https://github.com/NixOS/nixpkgs/";
        ref = "refs/heads/nixpkgs-unstable";
        rev = "14b0f20fa1f56438b74100513c9b1f7c072cf789";
      })
      { }).awscli2

    (import
      (builtins.fetchGit {
        # Descriptive name to make the store path easier to identify
        name = "aws-vault-6.3.1";
        url = "https://github.com/NixOS/nixpkgs/";
        ref = "refs/heads/nixpkgs-unstable";
        rev = "253aecf69ed7595aaefabde779aa6449195bebb7";
      })
      { }).aws-vault

    (import
      (builtins.fetchGit {
        # Descriptive name to make the store path easier to identify
        name = "nodejs-18.13.0";
        url = "https://github.com/NixOS/nixpkgs/";
        ref = "refs/heads/nixpkgs-unstable";
        rev = "2d38b664b4400335086a713a0036aafaa002c003";
    }) {}).nodejs-18_x

    (import
      (builtins.fetchGit {
        # Descriptive name to make the store path easier to identify
        name = "python3.10-pre-commit-2.20.0";
        url = "https://github.com/NixOS/nixpkgs/";
        ref = "refs/heads/nixpkgs-unstable";
        rev = "cd8d1784506a7c7eb0796772b73437e0b82fad57";
    }) {}).pre-commit
  ];
}
