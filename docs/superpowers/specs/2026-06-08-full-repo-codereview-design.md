# Full-Repo Code Review Design

Date: 2026-06-08

## Goal

Run a full-repository code review for BKToolBox and produce a prioritized remediation roadmap.

This is a baseline audit, not a narrow review of recent diffs. The review must cover the current repository state across desktop runtime, backend services, front-end surfaces, injection/automation, and Windows packaging/release paths.

## Non-Goals

- Do not start fixing findings as part of this review pass.
- Do not rewrite architecture documents unrelated to the review itself.
- Do not treat style-only nits as first-class output unless they indicate a deeper maintainability problem.
- Do not optimize for review speed at the cost of missing high-risk runtime and packaging issues.

## Requested Outcome

The user wants a comprehensive code review with two characteristics:

1. It is repository-wide rather than limited to recent changes.
2. It ends with a findings report and a phased remediation roadmap.

The user explicitly wants the review to include `tools/inject` and the injection chain, not just application-source directories.

## Review Scope

The review covers:

- `src/`
- `electron/`
- `lib/`
- `server.js`
- `runtime-paths.js`
- `scripts/`
- `tools/inject`
- `package.json`
- Windows build/package/release configuration and supporting scripts

The review also uses existing tests, docs, and recent commits as supporting evidence.

## Review Approaches Considered

### A. One-shot full sweep

Review every major area in one linear pass, then write a single report.

Pros:

- Maximum coverage in one uninterrupted sweep
- Simple process model

Cons:

- Late discovery of critical issues
- Weak feedback loop between early findings and later inspection
- High risk of ending with an unstructured issue dump

### B. Risk-first phased baseline audit

Review the repository in ordered phases based on runtime risk and operational impact, then merge results into one final report and roadmap.

Pros:

- Critical and high-risk paths are reviewed first
- Better alignment with BKToolBox's mixed desktop/backend/injection architecture
- Easier to convert findings into remediation order

Cons:

- Requires stricter recording discipline to keep phase outputs consistent
- Slightly more process overhead

### C. Recent-change-first review with historical backfill

Start from recent commits and active modules, then widen outward to older code.

Pros:

- Good at catching fresh regressions
- Efficient if the goal is release triage

Cons:

- Not a true repository baseline
- Can miss older but still severe architectural risks

## Chosen Approach

Approach B: risk-first phased baseline audit.

Reasoning:

- BKToolBox is not a uniform front-end repository; it combines Electron main/preload, Express APIs, Vue pages, local automation, and Windows packaging.
- A repository-wide review should front-load the paths most likely to cause crashes, broken automation, failed releases, or difficult-to-debug regressions.
- The user asked for a roadmap, so findings must already be organized in an execution-friendly order during review, not only at the end.

## Review Dimensions

Every phase uses the same six review dimensions:

1. Correctness and regression risk
2. Stability and failure recovery
3. Architecture and boundaries
4. Maintainability and consistency
5. Test coverage and verifiability
6. Packaging and release reliability

These dimensions prevent the review from collapsing into style commentary or isolated bug hunting.

## Phase Plan

### Phase 1: Runtime Backbone

Scope:

- `electron/main.js`
- preload and desktop bridge code
- `server.js`
- runtime path and process-coordination utilities
- `lib/` runtime backbones used directly by desktop/runtime startup paths
  - especially monitor, capture, persistence, and solver orchestration modules consumed by Electron or Express entrypoints

Primary questions:

- Is startup/shutdown behavior robust?
- Are main-process, preload, renderer, and backend responsibilities clearly separated?
- Are failure paths explicit, recoverable, and observable?

Acceptance signal for the phase:

- We can explain the main runtime data flow and error flow end-to-end.
- We have an evidence-backed list of runtime risks and weak recovery points.

### Phase 2: High-Change Product Surfaces

Scope:

- `src/home`
- `src/elsa`
- `src/ethan`
- `src/ahmed`
- `src/hero-estimator`
- `src/monitor`
- `src/price`
- `src/inject`
- `src/shared`
  - including TopBar, monitor switch state, agent switch state, and other shared UI/state helpers

Primary questions:

- Are page states isolated correctly?
- Are expensive computations kept off the UI thread where required?
- Are similar features implemented consistently across panels?

Acceptance signal for the phase:

- We can name the main state-management risks, duplicated logic clusters, and UI responsiveness hazards.
- We can identify high-value test gaps in user-facing flows.

### Phase 3: Injection and Automation Chain

Scope:

- `tools/inject`
- `electron/services/`
  - especially inject/agent/monitor/warehouse/listing-related service implementations
- IPC command contracts exposed by `electron/main.js`
  - reviewed here only for injection/automation-specific contract integrity, while `electron/main.js` runtime ownership remains in Phase 1
- command contracts between UI, desktop bridge, and injected tools

Primary questions:

- Is the agent lifecycle coherent across load/unload/crash/restart cases?
- Are automation commands type-consistent and failure-tolerant?
- Are there crash, stale-state, or zombie-process risks in the injection chain?

Acceptance signal for the phase:

- We can describe the injection lifecycle and identify any unsafe transitions or contract mismatches.
- We can distinguish between operational fragility and acceptable environment constraints.

### Phase 4: Packaging and Release Path

Scope:

- `package.json`
- Windows build config
- packaging scripts
- icon/resource patching
- runtime resource bundling
- deployment helpers

Primary questions:

- Is the build chain reproducible?
- Which release issues are configuration bugs versus environment constraints?
- Which packaging expectations are currently undocumented or implicit?

Acceptance signal for the phase:

- We can identify the main release blockers and fragile assumptions.
- We can separate fixable configuration issues from irreducible external requirements such as code signing.

### Phase 5: Architecture Debt and Test Debt Consolidation

Scope:

- Cross-phase synthesis

Primary questions:

- Which issues share the same root cause?
- What are the top structural debt clusters?
- Which missing tests most reduce future regression risk?

Acceptance signal for the phase:

- We can name the top refactor targets and test gaps without repeating the same issue in multiple forms.
- We can produce a roadmap rather than a flat list of complaints.
- We can map findings into the final remediation buckets of Immediate fixes, Short-term cleanup, and Medium-term refactors.

## Evidence Collection Method

The review should use the following order of operations:

1. Structural inspection first
   - Prefer CodeGraph for entry points, callers/callees, and impact radius.
2. Targeted source inspection second
   - Read only the files necessary to confirm the structural hypothesis.
3. Verification third
   - Run targeted tests or scripts when a claim requires runtime confirmation.
4. Findings last
   - Record only issues supported by code evidence, test evidence, command output, or explicit contract mismatch.

The review should avoid speculative findings with no reproducible basis.

## Output Format

The final review deliverable should contain three sections.

### 1. Findings Report

Primary section. Findings must be listed first and ordered by severity:

- Critical
- High
- Medium
- Low

Each finding must include:

- concise problem statement
- impact
- code evidence with file references
- why it is risky now
- suggested fix direction

### 2. Module Risk Heatmap

Summarize repository areas by current risk level, for example:

- Critical
- High
- Medium
- Low

This gives the user a fast picture of where maintenance energy should go.

### 3. Remediation Roadmap

Group work into:

- Immediate fixes
- Short-term cleanup
- Medium-term refactors

This roadmap is the main product-management output of the review.

## Review Discipline

- Findings-first reporting: no long summary before the issues.
- Evidence over opinion: no unsupported architectural claims.
- Root-cause grouping: repeated symptoms should be merged when they share the same source problem.
- No incidental implementation: the review does not silently turn into feature work.
- Immediate escalation rule: if a Critical issue is found, surface it to the user as soon as it is confirmed instead of waiting for the final aggregate report.
  - In practice, this happens through an interim progress update during the multi-phase review run.

## Risks and Constraints

- The repository mixes product code and environment-dependent tooling; some failures may be caused by machine state rather than code defects.
- Windows packaging observations must distinguish unsigned-binary behavior from pure configuration mistakes.
- Injection review can identify contract and lifecycle risks, but some runtime guarantees may still require live-game validation.
- Large files and legacy compatibility layers increase the chance that one symptom has several overlapping causes; cross-phase deduplication is necessary.

## Done When

This review design is complete when:

- the review scope is explicitly bounded,
- the phased order is agreed,
- the output format is explicit,
- the evidence standard is explicit,
- and the remediation roadmap requirement is built into the review process rather than added later.

The implementation-planning step, if approved, should convert this design into a detailed execution plan for performing the actual code review.
