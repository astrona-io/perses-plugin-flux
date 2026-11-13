# Contributing

Thanks for helping. Bug reports, fixes and small focused features are welcome. For anything larger,
open an issue first so we can agree on the approach.

This panel is read-only. A change that widens what it reads (a new path in
`deploy/kubernetes-datasource.json`, a new resource in `deploy/rbac.yaml`) needs a line in
[`docs/DECISIONS.md`](docs/DECISIONS.md) explaining why it is safe, and `test/allowlist/paths.json`
regenerated (`UPDATE_ALLOWLIST=1 npm test`).

## Setup

- Node 24 or later
- [`percli`](https://github.com/perses/perses/releases/tag/v0.55.1) v0.55.1
- [`cue`](https://cuelang.org/docs/introduction/installation/) on `PATH` (v0.17.1 tested)
- Go (for the allow-list test in `test/allowlist/`)

```bash
npm ci
```

## Build and check

```bash
npm run format:check            # oxfmt
npm run lint                    # oxlint
npm run type-check              # tsc
npm test                        # vitest: state mapping, delete impact, estate, fetch, history, panel, editor
(cd test/allowlist && go test)  # every path the panel reads against the allow-list, with Go's regexp engine
cue mod tidy --check
percli plugin test-schemas      # CUE schema against schemas/**/tests/{valid,invalid}
npm run build                   # module-federation bundle in dist/
percli plugin build             # writes FluxGitOps-<version>.tar.gz
```

CI runs all of them on every pull request. Please run them locally first.

## Try it in Perses

`dev/up.sh flux` and `dev/up.sh operator` start a kind cluster with Flux (or the Flux Operator), a
staged fleet with every state, Prometheus and Perses with this panel: see "Try it locally" in the
README. The README screenshots come from there; retake them after a visible change.

## Releasing

1. Set the version in `package.json` and `package-lock.json` (`npm version <X.Y.Z> --no-git-tag-version`),
   move the `Unreleased` entries in `CHANGELOG.md` under it, and merge that to `main`.
2. Push a tag `v<X.Y.Z>` on that commit. A prerelease tag (`v<X.Y.Z>-rc.1`) works the same way and is
   published as a GitHub prerelease.
3. The `release` workflow checks that the tag matches `package.json`, builds `FluxGitOps-<version>.tar.gz`
   with `percli plugin build`, attaches it and its `.sha256` to the GitHub release, and pushes
   `ghcr.io/astrona-io/perses-plugin-flux:<tag>` for linux/amd64 and linux/arm64, with build
   provenance attestations for both.
4. Write the release notes on the GitHub release: the workflow leaves them empty.

## Pull requests

- Keep each pull request to one change, and describe what you checked.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading.
- Sign off your commits (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/).

By contributing you agree that your contribution is licensed under Apache-2.0, as the project is.
