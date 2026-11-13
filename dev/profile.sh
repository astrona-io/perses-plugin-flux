# Sourced by up.sh, down.sh and push-commit.sh: names and host ports per profile.
#   flux      plain Flux (flux install), Perses on 127.0.0.1:18090
#   operator  Flux Operator + FluxInstance + ResourceSet, Perses on 127.0.0.1:18191
# shellcheck shell=bash
PROFILE="${1:-flux}"
case "$PROFILE" in
  flux)
    CLUSTER=perses-plugin-flux
    PERSES_PORT=18090
    REGISTRY_PORT=18190
    FLUX_WEB_PORT=18194
    FLEET_PATH=clusters/dev
    ;;
  operator)
    CLUSTER=perses-plugin-flux-operator
    PERSES_PORT=18191
    REGISTRY_PORT=18192
    FLUX_WEB_PORT=18193
    FLEET_PATH=clusters/operator
    ;;
  *)
    echo "unknown profile '$PROFILE' (flux or operator)" >&2
    exit 2
    ;;
esac
DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$DEV_DIR")"
CONTEXT="kind-$CLUSTER"
STATE_DIR="$DEV_DIR/.state/$PROFILE"
export KUBECONFIG="$STATE_DIR/kubeconfig"
export KIND_EXPERIMENTAL_PROVIDER="${KIND_EXPERIMENTAL_PROVIDER:-podman}"
FLUX_VERSION=v2.10.0
FLUX_OPERATOR_VERSION=0.62.1
KUBERNETES_PLUGIN_VERSION=0.1.0
k() { kubectl --context "$CONTEXT" "$@"; }
f() { flux --context "$CONTEXT" "$@"; }
