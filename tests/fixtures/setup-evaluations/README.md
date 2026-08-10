# Decision Setup Fixtures

This is isolated synthetic eligible-runtime unit coverage, not current production catalog semantic truth.
The production catalog status is 35/35 candidates held.

`decision-scenarios.yaml` is a schema-validated, non-authoritative input and
expected-outcome table for the semantic corpus. Its declared candidate count,
approval state, and execution failure are consumed by the test driver; unknown
keys are rejected. It deliberately contains no candidate, marketplace, or
recommendation data.

The unit harness reads the plugin-owned
`plugins/skillset-manager/data/decision-index.json` through the evaluation
harness, then derives an integrity-checked synthetic eligible-runtime index from
that held production source, including two synthetic eligible candidates where a
sequential failure path requires them. Its scenario states are assertions about
that isolated index only. Deterministic routing, expiry, approval, receipt, and
publication fixtures live in `tests/unit/setup-evaluator.test.ts` so no legacy
install catalog is available.
