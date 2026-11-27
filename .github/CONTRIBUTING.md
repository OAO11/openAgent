# Contributing to openAgent

See [local development](../docs/OPENAGENT_DEVELOPMENT.md) for setup, module ownership and checks. Product scope is the local desktop with K-brain; do not reintroduce a Gateway/WebUI or remote-control service.

Keep changes focused and preserve the desktop/shared-UI boundary. Include relevant validation in pull requests. Regenerate built-in resources with their source scripts, preserve attribution and licenses, and never commit credentials, application data, dependencies or build output.

The required CI checks are defined in [ci.yml](workflows/ci.yml). Contributions use the repository's [MIT license](../LICENSE); bundled third-party sources retain their respective licenses.
