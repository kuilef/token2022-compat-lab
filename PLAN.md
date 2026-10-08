# Approved regression experiment

Purpose: evaluate whether a reproducible cross-client fixture adds useful coverage to the upstream mocked resolver tests. This is a synthetic application integration example, not a live vulnerability claim.

1. Pin the released legacy 0.4.15 and Kit 0.19.0 clients, LiteSVM, and Token-2022 program 11.0.0. Record provenance and hashes. Use existing WSL on AMETHYST, project-local tools only.
2. Load a real validating transfer hook. Its extra PDA depends on recipient token-account owner bytes at offset 32. Reuse identical synthetic initial states for both clients.
3. Run existing ATA success; absent ATA standard resolver failure; correctly pre-resolved atomic ATA creation plus transfer; wrong extra PDA rejection with complete token-state rollback. Record observed/expected outcomes for all eight cases. Compare semantic state and errors, not serialized transactions.
4. Review current upstream coverage, run the complete project checks, and report go/no-go. Publish only if execution and attribution are sound, then wait for CI terminal status.

Stop if an equivalent upstream fixture is found or a substantial runtime/toolchain blocker makes the narrow experiment impractical.
