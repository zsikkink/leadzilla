'use client';

import { useCallback, useEffect, useState } from 'react';

import { Settings, Shield, SlidersHorizontal, Target } from 'lucide-react';

import { useAuth } from '../../../src/hooks/use-auth.js';
import { cn } from '../../../src/lib/utils.js';

// ── Validation ────────────────────────────────────────────────────────────

function validateDecimalScore(value: string): string | null {
  if (value === '') return null;
  const num = Number(value);
  if (isNaN(num)) return 'Must be a number';
  if (num < 0 || num > 1) return 'Score must be between 0 and 1';
  return null;
}

function validatePositiveInt(value: string): string | null {
  if (value === '') return null;
  const num = Number(value);
  if (isNaN(num) || !Number.isInteger(num)) return 'Must be a whole number';
  if (num < 0) return 'Must be 0 or greater';
  return null;
}

// ── Settings Page ─────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { apiClient } = useAuth();

  // Auto-approve state
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(false);
  const [scoreMin, setScoreMin] = useState('0.5');
  const [scoreMax, setScoreMax] = useState('1.0');
  const [minError, setMinError] = useState<string | null>(null);
  const [maxError, setMaxError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Qualification threshold state
  const [qualThreshold, setQualThreshold] = useState('0.4');
  const [qualError, setQualError] = useState<string | null>(null);

  // Min reviews state
  const [minReviews, setMinReviews] = useState('15');
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  // Shared state
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load all settings
  useEffect(() => {
    let cancelled = false;
    void apiClient.listPipelineSettings().then((res) => {
      if (cancelled) return;
      for (const item of res.items) {
        if (item.key === 'auto_approve_enabled') {
          setAutoApproveEnabled(item.value === true || item.value === 'true');
        } else if (item.key === 'auto_approve_score_min') {
          setScoreMin(String(item.value ?? '0.5'));
        } else if (item.key === 'auto_approve_score_max') {
          setScoreMax(String(item.value ?? '1.0'));
        } else if (item.key === 'scoreQualificationThreshold') {
          setQualThreshold(String(item.value ?? '0.4'));
        } else if (item.key === 'min_review_count') {
          setMinReviews(String(item.value ?? '15'));
        }
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [apiClient]);

  const handleSaveAll = useCallback(async () => {
    // Validate
    const minErr = validateDecimalScore(scoreMin);
    const maxErr = validateDecimalScore(scoreMax);
    const qualErr = validateDecimalScore(qualThreshold);
    const revErr = validatePositiveInt(minReviews);
    setMinError(minErr);
    setMaxError(maxErr);
    setQualError(qualErr);
    setReviewsError(revErr);

    if (minErr || maxErr || qualErr || revErr) return;

    const min = Number(scoreMin);
    const max = Number(scoreMax);
    if (min > max) {
      setRangeError('Min must be less than or equal to Max');
      return;
    }
    setRangeError(null);

    setSaving(true);
    try {
      await Promise.all([
        apiClient.updatePipelineSetting('auto_approve_enabled', autoApproveEnabled),
        apiClient.updatePipelineSetting('auto_approve_score_min', min),
        apiClient.updatePipelineSetting('auto_approve_score_max', max),
        apiClient.updatePipelineSetting('scoreQualificationThreshold', Number(qualThreshold)),
        apiClient.updatePipelineSetting('min_review_count', Number(minReviews)),
      ]);
    } catch {
      // Silently handle — settings may not all be wired yet
    } finally {
      setSaving(false);
    }
  }, [apiClient, autoApproveEnabled, scoreMin, scoreMax, qualThreshold, minReviews]);

  if (!loaded) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <SlidersHorizontal className="h-5 w-5 text-zbooni-teal" />
        <h1 className="text-xl font-bold tracking-tight">Pipeline Settings</h1>
      </div>

      {/* ── Auto-Approve Settings ─────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Auto-Approve Messages</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Automatically approve and send messages for leads within the score range.
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={autoApproveEnabled}
              onClick={() => setAutoApproveEnabled(!autoApproveEnabled)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                autoApproveEnabled ? 'bg-zbooni-green' : 'bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform',
                  autoApproveEnabled ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
            <span className="text-sm font-medium">Enable auto-approve</span>
          </label>

          {autoApproveEnabled ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground/60">
                Auto-approve messages for leads with score in range:
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={scoreMin}
                    onChange={(e) => { setScoreMin(e.target.value); setMinError(validateDecimalScore(e.target.value)); setRangeError(null); }}
                    placeholder="0.5"
                    className={cn(
                      'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                      minError ? 'border-red-500/50' : 'border-border/50',
                    )}
                  />
                  {minError ? <p className="mt-1 text-[10px] text-red-400">{minError}</p> : null}
                </div>
                <span className="text-xs text-muted-foreground/50">&le; score &le;</span>
                <div className="flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={scoreMax}
                    onChange={(e) => { setScoreMax(e.target.value); setMaxError(validateDecimalScore(e.target.value)); setRangeError(null); }}
                    placeholder="1.0"
                    className={cn(
                      'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                      maxError ? 'border-red-500/50' : 'border-border/50',
                    )}
                  />
                  {maxError ? <p className="mt-1 text-[10px] text-red-400">{maxError}</p> : null}
                </div>
              </div>
              {rangeError ? <p className="text-[10px] text-red-400">{rangeError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Qualification Threshold ───────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Qualification Threshold</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Minimum blended score for a lead to be considered qualified. Leads below this score are filtered out by default on the leads page.
        </p>
        <div className="max-w-xs">
          <input
            type="text"
            inputMode="decimal"
            value={qualThreshold}
            onChange={(e) => { setQualThreshold(e.target.value); setQualError(validateDecimalScore(e.target.value)); }}
            placeholder="0.4"
            className={cn(
              'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
              qualError ? 'border-red-500/50' : 'border-border/50',
            )}
          />
          {qualError ? <p className="mt-1 text-[10px] text-red-400">{qualError}</p> : null}
        </div>
      </div>

      {/* ── Minimum Google Reviews ────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Minimum Google Reviews</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Businesses with fewer Google reviews than this are disqualified during pre-qualification.
          Lower this to discover more businesses (at the cost of potentially lower quality leads).
        </p>
        <div className="max-w-xs">
          <input
            type="text"
            inputMode="numeric"
            value={minReviews}
            onChange={(e) => { setMinReviews(e.target.value); setReviewsError(validatePositiveInt(e.target.value)); }}
            placeholder="15"
            className={cn(
              'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
              reviewsError ? 'border-red-500/50' : 'border-border/50',
            )}
          />
          {reviewsError ? <p className="mt-1 text-[10px] text-red-400">{reviewsError}</p> : null}
        </div>
      </div>

      {/* ── Save ──────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
          ) : null}
          Save All Settings
        </button>
      </div>
    </div>
  );
}
