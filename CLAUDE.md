# Claude Notes

- Design docs first: before writing code for a feature or design change, write/update the design doc (under `docs/`) and align on it, then implement.
- Do not add local tests for this project.
- Do not add smoke, unit, integration, e2e, or test-runner scripts unless the user explicitly reverses this rule.
- For verification, prefer type checks, builds, lint-free syntax checks, manual UI inspection, or focused runtime/API checks.
