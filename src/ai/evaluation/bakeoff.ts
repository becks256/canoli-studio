/** Evaluation status only: synthetic fixtures cannot establish provider performance. */
export interface BakeoffReport {
  status: "incomplete";
  timestamp: string;
  providerCount: number;
  scorecards: Record<string, never>;
  primaryRecommendation: null;
  unmeasured: string[];
}

export function runProviderBakeoff(): BakeoffReport {
  return {
    status: "incomplete",
    timestamp: new Date().toISOString(),
    providerCount: 0,
    scorecards: {},
    primaryRecommendation: null,
    unmeasured: [
      "Actual provider outputs and alpha quality",
      "Requested versus decoded dimensions",
      "Reference drift and protected-region preservation",
      "Observed latency distribution",
      "Verified provider terms, retention, and commercial-use permissions",
      "Measured acceptance rate and cost per accepted output",
    ],
  };
}
