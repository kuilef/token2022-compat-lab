#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=3.1.8
sha256=e951bb8127c57460bc3ebca1671952e9b164e249d713fcebe2c125f70b8791e8
mkdir -p .tools/agave
archive=.tools/agave/solana-release-v${version}.tar.bz2
if [[ ! -f "$archive" ]]; then
  curl --fail --silent --show-error --location --max-time 180 "https://github.com/anza-xyz/agave/releases/download/v${version}/solana-release-x86_64-unknown-linux-gnu.tar.bz2" -o "$archive"
fi
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check
if [[ ! -f .tools/agave/solana-release/bin/solana-test-validator ]]; then
  tar -xjf "$archive" -C .tools/agave
fi
.tools/agave/solana-release/bin/solana-test-validator --version
.tools/agave/solana-release/bin/cargo-build-sbf --version
