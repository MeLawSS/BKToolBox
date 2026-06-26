# Code Review Prompt

## Goal

Complete a full-project code review for `A:\BidKing`, focusing on:

- correctness
- regressions
- testing contract drift
- test self-containment
- maintainability

## Non-goals

- security review
- feature development unrelated to review findings
- broad refactors without a concrete defect or contract issue

## Hard Constraints

- Follow `docs/RootInstruction.md`
- Prefer CodeGraph first when locating code in this indexed repository
- Do not revert unrelated dirty worktree changes
- Keep fixes scoped to verified findings
- Validate every meaningful fix with targeted tests before broader verification

## Deliverables

- Verified fixes for concrete review findings where low-risk changes are available
- Durable record of findings, decisions, and validation commands
- Clear list of remaining findings and risks

## Done When

- Reviewed failures are reduced to a small set of concrete, explained issues
- Implemented fixes pass targeted regression tests
- Review findings and current status are documented in repository markdown
