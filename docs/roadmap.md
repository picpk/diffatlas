# Roadmap

DiffAtlas Context focuses on smaller, inspectable coding inputs. These are possible next steps, not shipped features or delivery commitments. Priorities should follow reproducible failures on real tasks.

## Evidence before stronger claims

- Add independently annotated tasks from public repositories, with provenance and fixed revisions.
- Compare with path search, keyword retrieval, and manual context selection under equal budgets.
- Run opt-in model evaluations with fixed models and executable success criteria. Report quality regressions alongside input/output token usage.
- Keep synthetic selection results separate from real-task and model-quality results.

## Context selection

- Improve discovery of callers, tests, configuration, and dependencies without unbounded expansion.
- Add complete-unit parsing for more languages based on real requests.
- Resolve project aliases and workspace packages with explicit reports.
- Improve Unicode task matching and show weak lexical signals clearly.
- Make manual inclusion and before/after context inspection easier.

## Developer workflows

- Add measured integrations for local model clients and editor assistants.
- Explore incremental context to avoid resending unchanged code.
- Add an opt-in CI check for context budgets and evidence-retention regressions.
- Keep credentials and billing out of the default packing workflow.

## Existing review tools

Maintain the earlier diff review CLI and API for compatibility. Evidence validation remains useful, but review quality requires separate evaluation. New review features should have a demonstrated user need.

Propose a concrete use case and a small reproducible example before starting a large feature. See [the contribution guide](../CONTRIBUTING.md).
