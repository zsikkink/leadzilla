'use client';

import type { CreateIcpProfileRequest } from '@lead-flood/contracts';
import { Plus, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ApiError } from '../../../src/lib/api-client.js';
import { useApiQuery } from '../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../src/hooks/use-auth.js';

export default function IcpsPage() {
  const { apiClient } = useAuth();

  const icps = useApiQuery(
    useCallback(() => apiClient.listIcps({ page: 1, pageSize: 50 }), [apiClient]),
  );

  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [isActive, setIsActive] = useState(true);

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

  const resetForm = () => {
    setName('');
    setDescription('');
    setTargetIndustries('');
    setTargetCountries('');
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const data: CreateIcpProfileRequest = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(parseCommaSeparated(targetIndustries) ? { targetIndustries: parseCommaSeparated(targetIndustries) } : {}),
      ...(parseCommaSeparated(targetCountries) ? { targetCountries: parseCommaSeparated(targetCountries) } : {}),
      isActive,
    };

    try {
      await apiClient.createIcp(data);
      toast.success('ICP profile created');
      closeModal();
      icps.refetch();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else if (err instanceof Error) {
        setFormError(err.message);
      } else {
        setFormError('Failed to create ICP profile');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">ICP Profiles</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {icps.data ? `${icps.data.items.length} profiles configured` : 'Loading...'}
          </p>
        </div>
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
        <p className="text-sm text-destructive">{icps.error}</p>
      ) : null}

      {icps.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
          Loading ICP profiles...
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {icps.data?.items.map((icp) => (
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
                  {country}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {!icps.isLoading && icps.data?.items.length === 0 ? (
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-icp-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border/50 bg-card p-8 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-6">
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

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  placeholder="Describe your ideal customer profile..."
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
                  placeholder="UAE, Saudi Arabia, Qatar"
                />
                <p className="text-xs text-muted-foreground/60">Comma-separated list</p>
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

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
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
