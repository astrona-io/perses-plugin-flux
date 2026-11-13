#!/usr/bin/env bash
# Starts a dev stack: a kind cluster with Flux, a staged fleet, Prometheus + kube-state-metrics, and Perses
# with this panel and the Kubernetes datasource (astrona-io/perses-plugin-kubernetes).
#
#   dev/up.sh flux        plain Flux (flux install)                  Perses http://127.0.0.1:18090
#   dev/up.sh operator    Flux Operator, FluxInstance, ResourceSet   Perses http://127.0.0.1:18191
#   dev/push-commit.sh <profile> [healthy|broken|bump]               push a new fleet commit
#   dev/reload.sh <profile>                                          rebuild the plugin, restart Perses
#   dev/down.sh <profile>                                            delete the cluster
#
# Both profiles can run at the same time. Needs kind, kubectl, flux, helm (operator), curl, npm and percli;
# KIND_EXPERIMENTAL_PROVIDER defaults to podman. The kubeconfig goes to dev/.state/<profile>/kubeconfig,
# never ~/.kube/config, and every kubectl call names the context.
set -euo pipefail
# shellcheck source=profile.sh
source "$(cd "$(dirname "$0")" && pwd)/profile.sh" "${1:-flux}"
RENDERED="$STATE_DIR/provisioning"
KUBERNETES_URL="https://github.com/astrona-io/perses-plugin-kubernetes/releases/download/v$KUBERNETES_PLUGIN_VERSION/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz"
mkdir -p "$STATE_DIR" "$RENDERED" "$DEV_DIR/archive/flux" "$DEV_DIR/archive/kubernetes"

echo "==> Building the plugin archive"
(cd "$ROOT" && npm run build >/dev/null && percli plugin build >/dev/null)
rm -f "$DEV_DIR/archive/flux/"*.tar.gz
cp "$ROOT"/FluxGitOps-*.tar.gz "$DEV_DIR/archive/flux/"

if [ ! -f "$DEV_DIR/archive/kubernetes/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz" ]; then
  echo "==> Downloading the Kubernetes datasource v$KUBERNETES_PLUGIN_VERSION"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz" "$KUBERNETES_URL"
  curl -fsSL -o "$tmp/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz.sha256" "$KUBERNETES_URL.sha256"
  (cd "$tmp" && shasum -a 256 -c "Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz.sha256")
  mv "$tmp/Kubernetes-$KUBERNETES_PLUGIN_VERSION.tar.gz" "$DEV_DIR/archive/kubernetes/"
  rm -rf "$tmp"
fi

echo "==> Rendering provisioning for the $PROFILE profile"
cp "$DEV_DIR"/provisioning/*.yaml "$RENDERED/"
if [ "$PROFILE" = operator ]; then web="http://127.0.0.1:$FLUX_WEB_PORT/resource/\${kind}/\${namespace}/\${name}"; else web=""; fi
sed "s|__FLUX_WEB_URL__/resource/\${kind}/\${namespace}/\${name}|$web|" \
  "$DEV_DIR/provisioning/dashboard-gitops.json" >"$RENDERED/dashboard-gitops.json"

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "==> Creating the kind cluster $CLUSTER"
  sed -e "s|__CLUSTER__|$CLUSTER|" -e "s|__PERSES_PORT__|$PERSES_PORT|" -e "s|__REGISTRY_PORT__|$REGISTRY_PORT|" \
    -e "s|__FLUX_WEB_PORT__|$FLUX_WEB_PORT|" -e "s|__PROVISIONING_DIR__|$RENDERED|" -e "s|__DEV_DIR__|$DEV_DIR|g" \
    "$DEV_DIR/kind.yaml" >"$STATE_DIR/kind.yaml"
  kind create cluster --config "$STATE_DIR/kind.yaml" --kubeconfig "$KUBECONFIG" --wait 120s
fi

echo "==> Registry"
k apply -f "$DEV_DIR/k8s/registry.yaml" >/dev/null
k rollout status deployment/registry -n registry --timeout=180s >/dev/null
for _ in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$REGISTRY_PORT/v2/" && break; sleep 2; done

echo "==> First fleet commit (healthy)"
"$DEV_DIR/push-commit.sh" "$PROFILE" healthy

if [ "$PROFILE" = operator ]; then
  echo "==> Flux Operator $FLUX_OPERATOR_VERSION and the FluxInstance"
  helm --kube-context "$CONTEXT" upgrade --install flux-operator oci://ghcr.io/controlplaneio-fluxcd/charts/flux-operator \
    --version "$FLUX_OPERATOR_VERSION" --namespace flux-system --create-namespace --wait >/dev/null
  k apply -f "$DEV_DIR/k8s/fluxinstance.yaml" >/dev/null
  k wait fluxinstance/flux -n flux-system --for=condition=Ready --timeout=300s
else
  echo "==> Flux $FLUX_VERSION"
  f install --version="$FLUX_VERSION" >/dev/null
  k apply -f "$DEV_DIR/k8s/flux-sync.yaml" >/dev/null
fi

echo "==> Prometheus and kube-state-metrics"
k create namespace prometheus --dry-run=client -o yaml | k apply -f - >/dev/null
k create configmap kube-state-metrics-config -n prometheus --from-file=config.yaml="$ROOT/deploy/kube-state-metrics-config.yaml" \
  --dry-run=client -o yaml | k apply -f - >/dev/null
k apply -f "$DEV_DIR/k8s/prometheus.yaml" >/dev/null

echo "==> Perses"
k apply -f "$DEV_DIR/k8s/perses.yaml" -f "$ROOT/deploy/rbac.yaml" >/dev/null
k rollout restart deployment/perses -n perses >/dev/null
k rollout status deployment/perses -n perses --timeout=240s >/dev/null

echo "==> Waiting for the stages (the first install pulls images; a few minutes)"
k wait kustomization/apps -n flux-system --for=condition=Ready --timeout=600s >/dev/null || true
k wait helmrelease/metrics-gateway -n monitoring --for=condition=Ready --timeout=300s >/dev/null || true

echo "==> Drift: scaling widget-controller by hand, helm-controller corrects it"
k scale deployment/widget-controller-podinfo -n widget-system --replicas=3 >/dev/null 2>&1 || true
f reconcile helmrelease widget-controller -n widget-system >/dev/null 2>&1 || true

echo "==> Second fleet commit (broken: failing Helm upgrade, suspended tenants)"
"$DEV_DIR/push-commit.sh" "$PROFILE" broken

echo
echo "Perses: http://127.0.0.1:$PERSES_PORT/projects/flux/dashboards/gitops"
echo "New commit: dev/push-commit.sh $PROFILE    Delete: dev/down.sh $PROFILE"
