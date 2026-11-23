#!/usr/bin/env bash
# Smoke test: Perses with this plugin's archive and the Kubernetes datasource, reading a fake API server,
# then a headless browser opens the dashboard and checks the panel renders. Run after `npm run build`
# and `percli plugin build`:
#
#   test/smoke/run.sh
#
# Needs docker (or CONTAINER_ENGINE=podman) with compose, curl, and Playwright's Chromium
# (`npx playwright install chromium`). KEEP=1 leaves the stack running.
set -euo pipefail
SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SMOKE_DIR/../.." && pwd)"
ENGINE="${CONTAINER_ENGINE:-docker}"
KUBERNETES_PLUGIN_VERSION=0.1.0
KUBERNETES_PLUGIN_SHA256=d9e1c35d0e0d117f81dab48fe8a627b9ba0746b7c4a53a41eb1fec4457b7dc38
export SMOKE_PORT="${SMOKE_PORT:-18095}"
STATE="$SMOKE_DIR/.state"
compose() { "$ENGINE" compose -f "$SMOKE_DIR/compose.yaml" "$@"; }

version="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
archive="$ROOT/FluxGitOps-$version.tar.gz"
if [ ! -f "$archive" ]; then
  echo "$archive is missing: run npm run build && percli plugin build" >&2
  exit 1
fi

rm -rf "$STATE/archive/flux"
mkdir -p "$STATE/archive/flux" "$STATE/archive/kubernetes"
cp "$archive" "$STATE/archive/flux/"

kubernetes="$STATE/archive/kubernetes/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz"
if [ ! -f "$kubernetes" ]; then
  curl -fsSL -o "$kubernetes.part" \
    "https://github.com/astrona-io/perses-plugin-kubernetes/releases/download/v$KUBERNETES_PLUGIN_VERSION/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz"
  echo "$KUBERNETES_PLUGIN_SHA256  $kubernetes.part" | sha256sum --check --quiet 2>/dev/null ||
    echo "$KUBERNETES_PLUGIN_SHA256  $kubernetes.part" | shasum -a 256 --check --quiet
  mv "$kubernetes.part" "$kubernetes"
fi

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "==> Container logs"
    compose logs --no-color || true
  fi
  if [ "${KEEP:-}" != 1 ]; then compose down --volumes --timeout 1 >/dev/null 2>&1 || true; fi
  exit "$status"
}
trap cleanup EXIT

echo "==> Starting Perses and the fake API server"
compose up --detach --force-recreate

echo "==> Waiting for Perses to load the plugins and provision the dashboard"
url="http://127.0.0.1:$SMOKE_PORT"
for _ in $(seq 1 60); do
  if curl -fs "$url/api/v1/plugins" 2>/dev/null | grep -q '"FluxGitOps"' &&
    curl -fs -o /dev/null "$url/api/v1/projects/smoke/dashboards/flux" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [ "${ready:-}" != 1 ]; then
  echo "Perses did not load FluxGitOps or provision the dashboard in time" >&2
  exit 1
fi

echo "==> Rendering the dashboard"
cd "$ROOT"
npx playwright test --config test/smoke/playwright.config.ts
