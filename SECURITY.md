# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub security advisories](https://github.com/astrona-io/perses-plugin-flux/security/advisories/new)
("Report a vulnerability" on the repository's Security tab).

Include the plugin and Perses versions, what you found, and how to reproduce it. We will acknowledge
the report, keep you updated on the fix, and credit you in the advisory unless you prefer otherwise.

What counts: any way to make this panel, with the allow-list in `deploy/kubernetes-datasource.json` and
`deploy/rbac.yaml`, send a request other than a GET on a list endpoint, change anything in a cluster,
read a Secret, a ConfigMap or a token, or open a link that is not http(s) from a configured template.

## Supported versions

Only the latest release receives security fixes.
