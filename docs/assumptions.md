# Assumptions and limitations

- All inputs are **simulated**; Zod schemas require `simulated: true` on assets, roads, hazards and sites.
- **Exposure ≠ closure.** Footprint/road intersection yields "exposed". Closures are explicit per-scenario lists with a stated basis (invented rules).
- **Objective:** maximise worst-case weighted coverage over the supplied scenarios; tie-break on lower worst-case mean response (over reachable demands); final tie-break plan key (deterministic).
- **Coverage:** a demand is covered if the nearest compatible, available resource reaches it within the threshold (default 30 min). Each (location, resource type) demand counts once however many resources could serve it.
- **Unreachable** demands have `minutes = null` and are listed; they never receive finite times. Demands with no compatible resource are `no-resource` (unmet).
- **Scenario-specific eligibility:** resources staged at a site ineligible in a scenario are *lost* in that scenario (not relocated).
- **No probabilities** exist; none are invented. Equal-weight mean coverage is illustrative only.
- Temporal guard: planning rejects evidence that is `post-event` or whose `availableAt` is after the dataset cut-off (`asOf`). Post-event references live in a separate file/endpoint.
- Not modeled: congestion, debris, flood timing, mobilisation delay, resource heterogeneity, multi-hop logistics, one-way roads.
- Throughput: exhaustive enumeration is only suitable for a handful of resources/sites.
