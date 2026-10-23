# Roadmap

DiffAtlas is an early project. This document lists potential next steps, not shipped features or delivery commitments. Priorities should follow reproducible issues and feedback from people using the tool.

## Review quality

- Build a small, versioned evaluation set of authorized or synthetic diffs with human-reviewed expectations.
- Measure false positives, missed findings, and rejected evidence separately.
- Improve handling of unusual patch formats, renames, and truncated context.
- Make limitations caused by missing repository context easier to understand.

## Maintainer workflows

- Explore an opt-in GitHub Action that uploads reports without automatically posting comments.
- Compare reviews between revisions and track whether a finding still applies.
- Document examples of integrating SARIF with existing review tools.

## Deployment and usability

- Add deployment recipes in response to tested community setups.
- Improve keyboard navigation, screen-reader behavior, and internationalization.
- Evaluate additional model configurations with documented compatibility and measured results.

Propose a concrete use case in an issue before beginning a large feature. Do not include private code or credentials.
