// Checks the allow-list in deploy/kubernetes-datasource.json with Go's regexp engine, the one the
// Perses proxy uses.
//
// The Perses proxy forwards a request when the method is equal and the endpoint pattern matches the
// path (regexp.MatchString, unanchored), so every pattern is anchored. paths.json holds every path
// the panel reads; a vitest test in src/model/fetch.test.ts keeps it equal to what fetchEstate asks for.
package allowlist

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

type endpoint struct {
	EndpointPattern string `json:"endpointPattern"`
	Method          string `json:"method"`
}

type compiled struct {
	pattern *regexp.Regexp
	method  string
}

func load(t *testing.T) []compiled {
	t.Helper()
	raw, err := os.ReadFile("../../deploy/kubernetes-datasource.json")
	if err != nil {
		t.Fatal(err)
	}
	var ds struct {
		Spec struct {
			Plugin struct {
				Kind string `json:"kind"`
				Spec struct {
					Proxy struct {
						Spec struct {
							AllowedEndpoints []endpoint `json:"allowedEndpoints"`
						} `json:"spec"`
					} `json:"proxy"`
				} `json:"spec"`
			} `json:"plugin"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(raw, &ds); err != nil {
		t.Fatal(err)
	}
	if ds.Spec.Plugin.Kind != "KubernetesDatasource" {
		t.Fatalf("plugin kind %q, want KubernetesDatasource", ds.Spec.Plugin.Kind)
	}
	eps := ds.Spec.Plugin.Spec.Proxy.Spec.AllowedEndpoints
	if len(eps) == 0 {
		t.Fatal("no allowed endpoints")
	}
	out := make([]compiled, 0, len(eps))
	for _, e := range eps {
		if !strings.HasPrefix(e.EndpointPattern, "^") || !strings.HasSuffix(e.EndpointPattern, "$") {
			t.Errorf("pattern %q is not anchored", e.EndpointPattern)
		}
		if e.Method != "GET" {
			t.Errorf("pattern %q allows %s; the panel only reads", e.EndpointPattern, e.Method)
		}
		out = append(out, compiled{regexp.MustCompile(e.EndpointPattern), e.Method})
	}
	return out
}

// allowed mirrors the Perses proxy check.
func allowed(eps []compiled, method, path string) bool {
	for _, e := range eps {
		if e.method == method && e.pattern.MatchString(path) {
			return true
		}
	}
	return false
}

func TestEveryPanelPathIsAllowed(t *testing.T) {
	eps := load(t)
	raw, err := os.ReadFile("paths.json")
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Allowed []string `json:"allowed"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Allowed) == 0 {
		t.Fatal("paths.json is empty")
	}
	for _, path := range list.Allowed {
		if !allowed(eps, "GET", path) {
			t.Errorf("GET %s should be allowed", path)
		}
	}
}

func TestDeniedMethods(t *testing.T) {
	eps := load(t)
	for _, m := range []string{"POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT", "get"} {
		for _, path := range []string{
			"/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations",
			"/apis/fluxcd.controlplane.io/v1/namespaces/flux-system/fluxinstances",
		} {
			if allowed(eps, m, path) {
				t.Errorf("%s %s should be refused", m, path)
			}
		}
	}
}

func TestDeniedPaths(t *testing.T) {
	eps := load(t)
	for _, path := range []string{
		"/api/v1/secrets",
		"/api/v1/namespaces/flux-system/secrets",
		"/api/v1/namespaces/flux-system/secrets/flux-system",
		"/api/v1/namespaces/flux-system/configmaps",
		"/api/v1/namespaces/flux-system/serviceaccounts",
		"/api/v1/namespaces/flux-system/pods/source-controller-1/log",
		"/api/v1/namespaces/flux-system/pods/source-controller-1/exec",
		"/api/v1/namespaces/flux-system/services/notification-controller:80/proxy/",
		"/api/v1/namespaces/flux-system/services/source-controller:80/proxy/helmrepository/team-a1/podinfo/index-0f1e2d3c4b5a.yaml",
		"/api/v1/nodes/node-1/proxy/metrics",
		"/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations/apps",
		"/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations/apps/status",
		"/apis/helm.toolkit.fluxcd.io/v2/namespaces/apps/helmreleases/podinfo",
		"/apis/source.toolkit.fluxcd.io/v1/namespaces/flux-system/gitrepositories/flux-system",
		"/apis/fluxcd.controlplane.io/v1/namespaces/flux-system/fluxinstances/flux",
		"/apis/notification.toolkit.fluxcd.io/v1beta3/alerts",
		"/apis/image.toolkit.fluxcd.io/v1/imagepolicies",
		"/apis/kustomize.toolkit.fluxcd.io/v1/watch/kustomizations",
		"/apis/kustomize.toolkit.fluxcd.io/v1beta2/kustomizations",
		"/apis/source.toolkit.fluxcd.io/v1/namespaces/../secrets",
		"/apis/source.toolkit.fluxcd.io/v1/namespaces/a/b/gitrepositories",
		"/apis/source.toolkit.fluxcd.io/v1/gitrepositories/",
		"/apis/source.toolkit.fluxcd.io/v1/gitrepositories\n",
		"/apis/sourceXtoolkit.fluxcd.io/v1/gitrepositories",
		"/x/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations",
		"/apis/rbac.authorization.k8s.io/v1/clusterroles",
		"/version",
		"/",
	} {
		if allowed(eps, "GET", path) {
			t.Errorf("GET %q should be refused", path)
		}
	}
}
