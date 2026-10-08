#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .tools
version=v24.13.0
archive=node-${version}-linux-x64.tar.xz
if [[ ! -f .tools/node/bin/node ]] || [[ "$(.tools/node/bin/node --version)" != "$version" ]]; then
  curl --fail --silent --show-error --location --max-time 120 "https://nodejs.org/dist/${version}/${archive}" -o ".tools/${archive}"
  curl --fail --silent --show-error --location --max-time 30 "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o .tools/SHASUMS256.txt
  (cd .tools && grep "  ${archive}$" SHASUMS256.txt | sha256sum --check)
  mkdir -p .tools/node
  tar -xJf ".tools/${archive}" --strip-components=1 -C .tools/node
fi
export PATH="$PWD/.tools/node/bin:$PATH"
node --version
npm --version
