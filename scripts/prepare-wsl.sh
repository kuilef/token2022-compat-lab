#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
origin="$PWD"
mkdir -p /home/kuil/codex-workspaces/token2022-compat-lab
stage=$(mktemp -d /home/kuil/codex-workspaces/token2022-compat-lab/run.XXXXXX)
printf '%s\n' "$stage" > .wsl-stage-path
tar --exclude=.tools --exclude=.cache --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C "$stage"
mkdir -p "$stage/.tools/node" "$stage/.tools/fixtures"
if [[ -f .tools/node-v24.13.0-linux-x64.tar.xz && -f .tools/SHASUMS256.txt ]]; then
  (cd .tools && grep '  node-v24.13.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check)
  tar -xJf .tools/node-v24.13.0-linux-x64.tar.xz --strip-components=1 -C "$stage/.tools/node"
else
  (cd "$stage" && bash bootstrap.sh)
fi
if [[ -d .tools/fixtures ]]; then cp .tools/fixtures/*.so "$stage/.tools/fixtures/"; fi
cd "$stage"
export PATH="$PWD/.tools/node/bin:$PATH"
export npm_config_cache="$PWD/.cache/npm"
python3 scripts/fetch-fixtures.py
if [[ -f package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
else
  npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/
fi
cp package-lock.json "$origin/package-lock.json"
printf 'Isolated WSL workspace: %s\n' "$stage"
