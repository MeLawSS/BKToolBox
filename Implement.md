# Implementation Notes

- `Plan.md` is the execution source of truth for this review pass.
- For each fix:
  - identify the failing contract
  - patch the smallest correct surface
  - run targeted tests immediately
  - only then expand verification
- Do not widen scope because nearby code looks improvable.
- Keep this review focused on verified correctness, regression, test, and maintainability issues.
- Update `Documentation.md` after each meaningful conclusion so the next pass can resume without rediscovery.
