#!/usr/bin/env bash
# Rebuilds the plugin archive and restarts Perses in a running dev stack, so it extracts the new archive.
#
#   dev/reload.sh [flux|operator]
set -euo pipefail
# shellcheck source=profile.sh
source "$(cd "$(dirname "$0")" && pwd)/profile.sh" "${1:-flux}"
(cd "$ROOT" && npm run build >/dev/null && percli plugin build >/dev/null)
rm -f "$DEV_DIR/archive/flux/"*.tar.gz
cp "$ROOT"/FluxGitOps-*.tar.gz "$DEV_DIR/archive/flux/"
k -n perses rollout restart deployment/perses >/dev/null
k -n perses rollout status deployment/perses --timeout=120s
echo "Perses: http://127.0.0.1:$PERSES_PORT/projects/flux/dashboards/gitops"
