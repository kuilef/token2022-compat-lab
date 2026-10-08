#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != --inside ]]; then
  parent_namespace=$(readlink /proc/self/ns/net)
  exec unshare --user --map-root-user --net --fork bash scripts/run-agave-isolated.sh --inside "$parent_namespace"
fi
[[ "$(readlink /proc/self/ns/net)" != "$2" ]]
ip link set lo up
export TOKEN2022_ISOLATED_NETWORK=1
export TOKEN2022_PARENT_NETWORK_NAMESPACE="$2"
exec node src/run-agave.mjs
