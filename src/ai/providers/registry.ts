/**
 * Provider registry, capability matching, and human-approved budget enforcement.
 * Enforces strict budget ceilings and consent requirements before generation.
 */

import type {
  AiProviderAdapter,
  GenerationModality,
  GenerationRequest,
  HumanApprovedBudget,
  ProviderCapabilities,
} from "./types";

export interface ProviderQueryCriteria {
  modality?: GenerationModality;
  requireAlpha?: boolean;
  maxCostCents?: number;
  requiresZeroRetention?: boolean;
  maxLatencyP90Ms?: number;
  commercialSafeOnly?: boolean;
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderCapabilities>();
  private adapters = new Map<string, AiProviderAdapter>();

  constructor(initialProfiles: ProviderCapabilities[] = []) {
    for (const p of initialProfiles) {
      this.providers.set(p.id, p);
    }
  }

  registerProvider(profile: ProviderCapabilities): void {
    this.providers.set(profile.id, profile);
  }

  registerAdapter(adapter: AiProviderAdapter): void {
    this.adapters.set(adapter.capabilities.id, adapter);
    this.registerProvider(adapter.capabilities);
  }

  getProvider(id: string): ProviderCapabilities {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`AI Provider "${id}" not found in registry.`);
    }
    return provider;
  }

  getAdapter(id: string): AiProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(
        `AI Provider "${id}" is unconfigured or unavailable. Live external model inference is disabled in this environment. Register a configured provider adapter before submitting generation.`,
      );
    }
    return adapter;
  }

  hasAdapter(id: string): boolean {
    return this.adapters.has(id);
  }

  isProviderConfigured(id: string): boolean {
    return this.adapters.has(id);
  }

  listAdapters(): AiProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  listProviders(): ProviderCapabilities[] {
    return Array.from(this.providers.values());
  }

  findMatchingProviders(
    criteria: ProviderQueryCriteria,
  ): ProviderCapabilities[] {
    return this.listProviders().filter((p) => {
      if (criteria.modality && !p.modalities.includes(criteria.modality)) {
        return false;
      }
      if (criteria.requireAlpha && p.alpha === "unsupported") {
        return false;
      }
      if (criteria.maxCostCents !== undefined) {
        const estCost =
          p.pricing.costPerStandardImageCents +
          (criteria.requireAlpha && p.alpha === "post-process-matting-required"
            ? p.pricing.secondaryMattingCostCents
            : 0);
        if (estCost > criteria.maxCostCents) return false;
      }
      if (
        criteria.requiresZeroRetention &&
        p.terms.retentionPolicy !== "zero-retention-ephemeral"
      ) {
        return false;
      }
      if (
        criteria.maxLatencyP90Ms !== undefined &&
        p.latency.p90Ms > criteria.maxLatencyP90Ms
      ) {
        return false;
      }
      if (criteria.commercialSafeOnly && !p.terms.commercialUsePermitted) {
        return false;
      }
      return true;
    });
  }

  /**
   * Calculates the estimated cost in cents for a generation request.
   */
  estimateGenerationCost(
    providerId: string,
    request: GenerationRequest,
  ): number {
    const provider = this.getProvider(providerId);
    let baseCost =
      request.qualityTier === "hd" &&
      provider.pricing.costPerHdImageCents !== undefined
        ? provider.pricing.costPerHdImageCents
        : provider.pricing.costPerStandardImageCents;

    // Megapixel scaling if configured (baseline is 1.0 MP = 1024x1024)
    if (provider.pricing.costPerMegapixelCents) {
      const mp = (request.targetWidth * request.targetHeight) / (1024 * 1024);
      if (mp > 1.0) {
        baseCost += (mp - 1.0) * provider.pricing.costPerMegapixelCents;
      }
    }

    // Secondary matting cost if alpha requested on non-native provider
    if (
      request.requireAlpha &&
      provider.alpha === "post-process-matting-required"
    ) {
      baseCost += provider.pricing.secondaryMattingCostCents;
    }

    return Math.round(baseCost * 100) / 100;
  }

  /**
   * Validates that a human-approved budget exists, consent is confirmed,
   * and that the estimated generation cost does not exceed the remaining ceiling.
   */
  validateBudgetConsent(
    budget: HumanApprovedBudget,
    estimatedCostCents: number,
  ): void {
    if (!budget.consentGiven) {
      throw new Error(
        "Explicit human consent required before generative API invocation.",
      );
    }
    if (!budget.approverId || budget.approverId.trim() === "") {
      throw new Error(
        "Budget must be explicitly approved by an authorized user ID.",
      );
    }
    if (budget.approvedCeilingCents <= 0) {
      throw new Error(
        "Approved budget ceiling must be greater than zero cents.",
      );
    }

    const projectedTotal = budget.spentSoFarCents + estimatedCostCents;
    if (projectedTotal > budget.approvedCeilingCents) {
      throw new Error(
        `Estimated generation cost (${estimatedCostCents}¢) exceeds remaining approved budget ceiling (${budget.approvedCeilingCents - budget.spentSoFarCents}¢ remaining of ${budget.approvedCeilingCents}¢ total).`,
      );
    }
  }
}
