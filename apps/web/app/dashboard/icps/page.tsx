'use client';

import type { CreateIcpProfileRequest, IcpProfileResponse, QualificationLogic } from '@lead-flood/contracts';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { MENA_COUNTRIES, countryName, toDiscoveryCountryCodes } from '../../../src/lib/countries.js';
import { toSafeDisplayErrorMessage } from '../../../src/lib/error-messages.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

export default function IcpsPage() {
  const { apiClient } = useAuth();

  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50 }), [apiClient]),
  );
  const [icpItems, setIcpItems] = useState<IcpProfileResponse[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [salesHook, setSalesHook] = useState('');
  const [minCompanySize, setMinCompanySize] = useState('');
  const [maxCompanySize, setMaxCompanySize] = useState('');
  const [requiredTechnologies, setRequiredTechnologies] = useState('');
  const [excludedDomains, setExcludedDomains] = useState('');
  const [qualificationLogic, setQualificationLogic] = useState('');
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (icps.data) {
      setIcpItems(icps.data.items);
    }
  }, [icps.data]);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the name input when modal opens
  useEffect(() => {
    if (showModal) {
      // Small delay so the DOM is painted before focus
      const t = setTimeout(() => nameInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [showModal]);

  // Close on Escape
  useEffect(() => {
    if (!showModal) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showModal]);

  // MENA auto-fill: watch for "MENA" keyword in target countries
  useEffect(() => {
    const trimmed = targetCountries.trim();
    if (trimmed.toUpperCase() === 'MENA') {
      setTargetCountries(MENA_COUNTRIES.map((country) => countryName(country)).join(', '));
    }
  }, [targetCountries]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setTargetIndustries('');
    setTargetCountries('');
    setSalesHook('');
    setMinCompanySize('');
    setMaxCompanySize('');
    setRequiredTechnologies('');
    setExcludedDomains('');
    setQualificationLogic('');
    setShowAdvancedSettings(false);
    setIsActive(true);
    setFormError(null);
  };

  const openModal = () => {
    resetForm();
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
  };

  const parseCommaSeparated = (value: string): string[] | undefined => {
    const items = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  };

  const parseOptionalPositiveInteger = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('Company size fields must be positive whole numbers.');
    }
    return parsed;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const parsedMinCompanySize = parseOptionalPositiveInteger(minCompanySize);
      const parsedMaxCompanySize = parseOptionalPositiveInteger(maxCompanySize);
      if (
        parsedMinCompanySize !== undefined &&
        parsedMaxCompanySize !== undefined &&
        parsedMinCompanySize > parsedMaxCompanySize
      ) {
        throw new Error('Min Company Size must be less than or equal to Max Company Size.');
      }

      const parsedTargetIndustries = parseCommaSeparated(targetIndustries);
      const parsedTargetCountries = toDiscoveryCountryCodes(parseCommaSeparated(targetCountries) ?? []);
      const parsedRequiredTechnologies = parseCommaSeparated(requiredTechnologies);
      const parsedExcludedDomains = parseCommaSeparated(excludedDomains);
      const normalizedQualificationLogic = qualificationLogic.trim().toUpperCase();
      if (normalizedQualificationLogic.length > 0 && normalizedQualificationLogic !== 'WEIGHTED') {
        throw new Error('Qualification Logic currently supports only WEIGHTED.');
      }
      const parsedQualificationLogic = normalizedQualificationLogic.length > 0
        ? ('WEIGHTED' as QualificationLogic)
        : undefined;
      const metadataJson = {
        ...(salesHook.trim() ? { salesHook: salesHook.trim() } : {}),
      };

      const data: CreateIcpProfileRequest = {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsedTargetIndustries ? { targetIndustries: parsedTargetIndustries } : {}),
        ...(parsedTargetCountries.length > 0 ? { targetCountries: parsedTargetCountries } : {}),
        ...(Object.keys(metadataJson).length > 0 ? { metadataJson } : {}),
        ...(parsedMinCompanySize !== undefined ? { minCompanySize: parsedMinCompanySize } : {}),
        ...(parsedMaxCompanySize !== undefined ? { maxCompanySize: parsedMaxCompanySize } : {}),
        ...(parsedRequiredTechnologies ? { requiredTechnologies: parsedRequiredTechnologies } : {}),
        ...(parsedExcludedDomains ? { excludedDomains: parsedExcludedDomains } : {}),
        ...(parsedQualificationLogic ? { qualificationLogic: parsedQualificationLogic } : {}),
        isActive,
      };

      const created = await apiClient.createIcp(data);
      setIcpItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      toast.success('ICP profile created');
      closeModal();
      void icps.refetch();
    } catch (err: unknown) {
      setFormError(
        toSafeDisplayErrorMessage(
          err,
          'Couldn’t create this profile. Review the selected options and try again.',
        ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {icps.data ? `${icpItems.length} profiles configured` : 'Loading...'}
        </p>
        <button
          type="button"
          onClick={openModal}
          className="zbooni-gradient-bg inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:opacity-90 hover:shadow-zbooni-green/30"
        >
          <Plus className="h-4 w-4" />
          Create ICP
        </button>
      </div>

      {icps.error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
          <span>ICP profiles are refreshing. Previously loaded profiles remain available.</span>
          <button
            type="button"
            onClick={() => void icps.refetch()}
            className="shrink-0 rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-400/10"
          >
            Refresh
          </button>
        </div>
      ) : null}

      {icps.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading ICP profiles...
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {icpItems.map((icp) => (
          <Link
            key={icp.id}
            href={`/dashboard/icps/${icp.id}`}
            className="group rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold tracking-tight group-hover:text-primary transition-colors">{icp.name}</h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  icp.isActive
                    ? 'bg-zbooni-green/15 text-zbooni-green'
                    : 'bg-gray-500/15 text-gray-400'
                }`}
              >
                {icp.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {icp.description ? (
              <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{icp.description}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-1">
              {icp.targetIndustries.map((industry) => (
                <span
                  key={industry}
                  className="rounded-full bg-zbooni-dark/60 px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {industry}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {icp.targetCountries.map((country) => (
                <span
                  key={country}
                  className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-xs text-zbooni-teal"
                >
                  {countryName(country)}
                </span>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-border/30 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Qualification signals</span>
              <span className="ml-auto text-sm font-bold text-muted-foreground">
                {icp.qualificationRules?.length ?? 0}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {!icps.isLoading && icpItems.length === 0 ? (
        <div className="rounded-2xl border border-border/50 bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground/60">No ICP profiles configured.</p>
          <button
            type="button"
            onClick={openModal}
            className="mt-3 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Create your first ICP profile
          </button>
        </div>
      ) : null}

      {/* Create ICP Modal */}
      {showModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-icp-title"
        >
          <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-card px-6 py-5">
              <h2 id="create-icp-title" className="text-xl font-extrabold tracking-tight">
                Create ICP Profile
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* Name */}
              <div className="space-y-2">
                <label htmlFor="icp-name" className="text-sm font-medium text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id="icp-name"
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. UAE Enterprise SaaS"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="icp-description" className="text-sm font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  id="icp-description"
                  maxLength={2000}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="flex w-full rounded-xl border border-input bg-background px-4 py-3 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  placeholder="Include: target company types, pain points (what's broken today), buying triggers (when they're most receptive), features to pitch, and objections to overcome.&#10;&#10;Example: 'Luxury yacht charters struggling with international payment failures. Average deal AED 5K-100K. Pain: Failed Amex/ApplePay kills bookings. Win with: Multi-MID retries, instant confirmation, live support.'"
                />
              </div>

              {/* Target Industries */}
              <div className="space-y-2">
                <label htmlFor="icp-industries" className="text-sm font-medium text-muted-foreground">
                  Target Industries
                </label>
                <input
                  id="icp-industries"
                  type="text"
                  value={targetIndustries}
                  onChange={(e) => setTargetIndustries(e.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Fintech, SaaS, E-commerce"
                />
                <p className="text-xs text-muted-foreground/60">Comma-separated list</p>
              </div>

              {/* Target Countries */}
              <div className="space-y-2">
                <label htmlFor="icp-countries" className="text-sm font-medium text-muted-foreground">
                  Target Countries
                </label>
                <input
                  id="icp-countries"
                  type="text"
                  value={targetCountries}
                  onChange={(e) => setTargetCountries(e.target.value)}
                  className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="United Arab Emirates, Germany, US"
                />
                <p className="text-xs text-muted-foreground/60">
                  Comma-separated list. Country names, aliases, and ISO codes all work. Type &quot;MENA&quot; to auto-fill the current MENA defaults.
                </p>
              </div>

              {/* Sales Hook */}
              <div className="space-y-2">
                <label htmlFor="icp-sales-hook" className="text-sm font-medium text-muted-foreground">
                  Sales Hook
                </label>
                <textarea
                  id="icp-sales-hook"
                  rows={3}
                  value={salesHook}
                  onChange={(e) => setSalesHook(e.target.value)}
                  className="flex w-full rounded-xl border border-input bg-background px-4 py-3 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                  placeholder="What opening value proposition should the AI lead with for this ICP?"
                />
                <p className="text-xs text-muted-foreground/60">
                  The specific value proposition or opening line the AI will use when crafting messages for leads in this ICP.
                </p>
              </div>

              {/* Advanced Settings */}
              <div className="rounded-xl border border-input bg-background">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings((prev) => !prev)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  aria-expanded={showAdvancedSettings}
                  aria-controls="icp-advanced-settings"
                >
                  <span className="text-sm font-medium text-muted-foreground">Advanced Settings (Optional)</span>
                  {showAdvancedSettings ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showAdvancedSettings ? (
                  <div id="icp-advanced-settings" className="space-y-4 border-t border-input px-4 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="icp-min-company-size" className="text-sm font-medium text-muted-foreground">
                          Min Company Size
                        </label>
                        <input
                          id="icp-min-company-size"
                          type="number"
                          min={1}
                          step={1}
                          value={minCompanySize}
                          onChange={(e) => setMinCompanySize(e.target.value)}
                          className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          placeholder="e.g. 10"
                        />
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="icp-max-company-size" className="text-sm font-medium text-muted-foreground">
                          Max Company Size
                        </label>
                        <input
                          id="icp-max-company-size"
                          type="number"
                          min={1}
                          step={1}
                          value={maxCompanySize}
                          onChange={(e) => setMaxCompanySize(e.target.value)}
                          className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                          placeholder="e.g. 500"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="icp-required-technologies" className="text-sm font-medium text-muted-foreground">
                        Required Technologies
                      </label>
                      <input
                        id="icp-required-technologies"
                        type="text"
                        value={requiredTechnologies}
                        onChange={(e) => setRequiredTechnologies(e.target.value)}
                        className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="Shopify, HubSpot, Salesforce"
                      />
                      <p className="text-xs text-muted-foreground/60">Comma-separated list</p>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="icp-excluded-domains" className="text-sm font-medium text-muted-foreground">
                        Excluded Domains
                      </label>
                      <input
                        id="icp-excluded-domains"
                        type="text"
                        value={excludedDomains}
                        onChange={(e) => setExcludedDomains(e.target.value)}
                        className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm transition-colors placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="gmail.com, yahoo.com"
                      />
                      <p className="text-xs text-muted-foreground/60">Comma-separated list</p>
                    </div>

                  </div>
                ) : null}
              </div>

              {/* Active Toggle */}
              <div className="flex items-center justify-between rounded-xl border border-input bg-background px-4 py-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground/60">Start scoring leads immediately</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => setIsActive(!isActive)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                    isActive ? 'bg-zbooni-green' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform ${
                      isActive ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Error */}
              {formError ? (
                <p className="text-sm font-medium text-destructive">{formError}</p>
              ) : null}
              </div>

              {/* Actions */}
              <div className="sticky bottom-0 flex items-center gap-3 border-t border-border/50 bg-card px-6 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-input text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className="zbooni-gradient-bg inline-flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-semibold text-zbooni-dark shadow-lg shadow-zbooni-green/20 transition-all hover:opacity-90 hover:shadow-zbooni-green/30 disabled:pointer-events-none disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zbooni-dark/30 border-t-zbooni-dark" />
                      Creating...
                    </span>
                  ) : (
                    'Create ICP'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
