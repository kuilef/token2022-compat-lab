#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
bash bootstrap.sh
export PATH="$PWD/.tools/node/bin:$PATH"
export npm_config_cache="$PWD/.cache/npm"
if [[ -f package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
else
  npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
fi
