# Decision Setup Fixtures

`decision-scenarios.yaml` is a schema-validated, non-authoritative input and
expected-outcome table for the semantic corpus. Its declared candidate count,
approval state, and execution failure are consumed by the test driver; unknown
keys are rejected. It deliberately contains no candidate, marketplace, or
recommendation data.

The semantic setup corpus reads the plugin-owned
`plugins/skillset-manager/data/decision-index.json` through the evaluation
harness. The driver derives an integrity-checked authorized test index from
that source, including two candidates where a sequential failure path requires
them. Deterministic routing, expiry, approval, receipt, and publication fixtures
live in `tests/unit/setup-evaluator.test.ts` so no legacy install catalog is
available.
