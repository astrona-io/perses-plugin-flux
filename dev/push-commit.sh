#!/usr/bin/env bash
# Pushes a new commit of dev/fleet to the dev registry and tells source-controller to fetch it, so the
# panel shows the revision going out of sync, reconciling and settling.
#
#   dev/push-commit.sh [flux|operator] [healthy|broken|bump]
#
#   healthy  everything installs; the tenants Kustomization runs
#   broken   the monitoring Helm release upgrades to an image tag that does not exist (fails after its
#            45s timeout, so apps waits on it) and tenants is suspended. This is the demo state.
#   bump     a new commit with the last mode's content plus one changed annotation (default)
#
# Each push is a real commit in dev/.state/<profile>/fleet (a local git repository), pushed as an OCI
# artifact with revision main@sha1:<commit>.
set -euo pipefail
# shellcheck source=profile.sh
source "$(cd "$(dirname "$0")" && pwd)/profile.sh" "${1:-flux}"
MODE="${2:-bump}"
REPO="$STATE_DIR/fleet"
mkdir -p "$STATE_DIR"
if [ "$MODE" = bump ]; then MODE="$(cat "$STATE_DIR/mode" 2>/dev/null || echo broken)"; fi
case "$MODE" in
  healthy) TAG=6.7.1 SUSPEND=false ;;
  broken) TAG=0.0.0-does-not-exist SUSPEND=true ;;
  *) echo "unknown mode '$MODE' (healthy, broken or bump)" >&2; exit 2 ;;
esac
echo "$MODE" >"$STATE_DIR/mode"

if [ ! -d "$REPO/.git" ]; then
  git init -q -b main "$REPO"
  git -C "$REPO" config user.name "dev stack"
  git -C "$REPO" config user.email "dev@example.com"
fi
n=$(($(git -C "$REPO" rev-list --count HEAD 2>/dev/null || echo 0) + 1))
find "$REPO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$DEV_DIR/fleet/." "$REPO/"
find "$REPO" -name '*.yaml' -exec sed -i.bak \
  -e "s/__METRICS_GATEWAY_TAG__/$TAG/" -e "s/__SUSPEND_TENANTS__/$SUSPEND/" -e "s/__COMMIT__/$n/" {} +
find "$REPO" -name '*.bak' -delete
git -C "$REPO" add -A
git -C "$REPO" commit -q -m "dev: $MODE ($n)"
sha="$(git -C "$REPO" rev-parse HEAD)"

flux push artifact "oci://127.0.0.1:$REGISTRY_PORT/fleet:latest" --path="$REPO" \
  --source="https://github.com/example/fleet" --revision="main@sha1:$sha" --insecure-registry >/dev/null
echo "pushed main@sha1:${sha:0:7} ($MODE)"
if k get ocirepository flux-system -n flux-system >/dev/null 2>&1; then
  f reconcile source oci flux-system -n flux-system >/dev/null 2>&1 || true
fi
