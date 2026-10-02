# Generative provider evaluation — incomplete

The earlier T10 report is withdrawn. Its quality scores were derived from synthetic fixture pixels, latency values were profile constants, and its provider recommendation was hardcoded. Those calculations are not measurements of model behavior. No provider has passed the T10 evaluation gate.

Production has no bundled generation adapters. Procedural simulators live under `tests/fixtures/generation` and require explicit test registration. Unconfigured generation fails instead of returning synthetic images. Unverified candidate profiles also live only in test fixtures; they are not current pricing, capability, retention, or legal evidence. The production registry starts empty.

The metric utilities remain useful for testing calculations. `runProviderBakeoff()` reports incomplete status, zero evaluated providers, no scorecards, and no recommendation. It does not invoke providers or spend money.

Before recommending a provider, obtain actual outputs for a held-out corpus, record requests and decoded image properties, measure alpha quality and reference drift, collect observed latency and acceptance rates, and calculate costs from recorded usage. Verify current provider terms and retention against authoritative sources. Paid evaluation requires an approved budget and configured credentials; neither has been supplied for this correction.
