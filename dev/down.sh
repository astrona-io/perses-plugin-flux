#!/usr/bin/env bash
# Deletes one profile's dev cluster and its state (kubeconfig, rendered files, local fleet repository).
# Leaves the plugin archives in dev/archive.
#
#   dev/down.sh [flux|operator]
set -euo pipefail
# shellcheck source=profile.sh
source "$(cd "$(dirname "$0")" && pwd)/profile.sh" "${1:-flux}"
kind delete cluster --name "$CLUSTER" --kubeconfig "$KUBECONFIG"
rm -rf "$STATE_DIR"
