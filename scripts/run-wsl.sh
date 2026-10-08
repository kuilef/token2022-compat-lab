#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
origin="$PWD"
stage=$(cat .wsl-stage-path)
[[ "$stage" == /home/kuil/codex-workspaces/token2022-compat-lab/run.* && -d "$stage" ]]
cp package.json "$stage/package.json"
for directory in src test scripts; do cp -R "$directory" "$stage/"; done
if [[ -f eslint.config.mjs ]]; then cp eslint.config.mjs "$stage/"; fi
cd "$stage"
export PATH="$PWD/.tools/node/bin:$PATH"
"$@"
if [[ -f report.json ]]; then cp report.json "$origin/report.json"; fi
