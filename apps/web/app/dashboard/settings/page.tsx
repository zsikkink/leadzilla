'use client';

import { useCallback, useEffect, useState } from 'react';

import { MessageSquare, Settings, Shield, SlidersHorizontal, Target } from 'lucide-react';

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

  // Deterministic/AI blend state
  const [blendAutoMode, setBlendAutoMode] = useState(true);
  const [blendOverride, setBlendOverride] = useState(50);

  // Score tier bands state
  const [tierLow, setTierLow] = useState('0.34');
  const [tierHigh, setTierHigh] = useState('0.67');
  const [tierLowError, setTierLowError] = useState<string | null>(null);
  const [tierHighError, setTierHighError] = useState<string | null>(null);
  const [tierRangeError, setTierRangeError] = useState<string | null>(null);

  // Enrichment threshold state
  const [enrichThreshold, setEnrichThreshold] = useState('0.3');
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // Follow-up max count state
  const [followUpMax, setFollowUpMax] = useState('3');
  const [followUpError, setFollowUpError] = useState<string | null>(null);

  // Daily send limits state
  const [whatsappLimit, setWhatsappLimit] = useState('50');
  const [emailLimit, setEmailLimit] = useState('100');
  const [whatsappLimitError, setWhatsappLimitError] = useState<string | null>(null);
  const [emailLimitError, setEmailLimitError] = useState<string | null>(null);

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
        } else if (item.key === 'deterministicAiBlend') {
          if (item.value == null) {
            setBlendAutoMode(true);
          } else {
            setBlendAutoMode(false);
            setBlendOverride(Math.round(Number(item.value) * 100));
          }
        } else if (item.key === 'scoreTierBands') {
          if (item.value != null && typeof item.value === 'object') {
            const bands = item.value as { low?: number; high?: number };
            if (bands.low != null) setTierLow(String(bands.low));
            if (bands.high != null) setTierHigh(String(bands.high));
          }
        } else if (item.key === 'enrichmentThreshold') {
          setEnrichThreshold(String(item.value ?? '0.3'));
        } else if (item.key === 'followUpMaxCount') {
          setFollowUpMax(String(item.value ?? '3'));
        } else if (item.key === 'whatsappDailyLimit') {
          setWhatsappLimit(String(item.value ?? '50'));
        } else if (item.key === 'emailDailyLimit') {
          setEmailLimit(String(item.value ?? '100'));
        }
      }
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [apiClient]);

  const handleSaveAll = useCallback(async () => {
    // Validate existing fields
    const minErr = validateDecimalScore(scoreMin);
    const maxErr = validateDecimalScore(scoreMax);
    const qualErr = validateDecimalScore(qualThreshold);
    const revErr = validatePositiveInt(minReviews);
    setMinError(minErr);
    setMaxError(maxErr);
    setQualError(qualErr);
    setReviewsError(revErr);

    // Validate new fields
    const tLowErr = validateDecimalScore(tierLow);
    const tHighErr = validateDecimalScore(tierHigh);
    const eThreshErr = validateDecimalScore(enrichThreshold);
    const fUpErr = validatePositiveInt(followUpMax);
    const waErr = validatePositiveInt(whatsappLimit);
    const emErr = validatePositiveInt(emailLimit);
    setTierLowError(tLowErr);
    setTierHighError(tHighErr);
    setEnrichError(eThreshErr);
    setFollowUpError(fUpErr);
    setWhatsappLimitError(waErr);
    setEmailLimitError(emErr);

    if (minErr || maxErr || qualErr || revErr || tLowErr || tHighErr || eThreshErr || fUpErr || waErr || emErr) return;

    const min = Number(scoreMin);
    const max = Number(scoreMax);
    if (min > max) {
      setRangeError('Min must be less than or equal to Max');
      return;
    }
    setRangeError(null);

    // Validate tier band range
    const lowNum = Number(tierLow);
    const highNum = Number(tierHigh);
    if (lowNum >= highNum) {
      setTierRangeError('LOW threshold must be less than HIGH threshold');
      return;
    }
    setTierRangeError(null);

    setSaving(true);
    try {
      await Promise.all([
        apiClient.updatePipelineSetting('auto_approve_enabled', autoApproveEnabled),
        apiClient.updatePipelineSetting('auto_approve_score_min', min),
        apiClient.updatePipelineSetting('auto_approve_score_max', max),
        apiClient.updatePipelineSetting('scoreQualificationThreshold', Number(qualThreshold)),
        apiClient.updatePipelineSetting('min_review_count', Number(minReviews)),
        apiClient.updatePipelineSetting('deterministicAiBlend', blendAutoMode ? null : blendOverride / 100),
        apiClient.updatePipelineSetting('scoreTierBands', { low: lowNum, high: highNum }),
        apiClient.updatePipelineSetting('enrichmentThreshold', Number(enrichThreshold)),
        apiClient.updatePipelineSetting('followUpMaxCount', Number(followUpMax)),
        apiClient.updatePipelineSetting('whatsappDailyLimit', Number(whatsappLimit)),
        apiClient.updatePipelineSetting('emailDailyLimit', Number(emailLimit)),
      ]);
    } catch {
      // Silently handle — settings may not all be wired yet
    } finally {
      setSaving(false);
    }
  }, [apiClient, autoApproveEnabled, scoreMin, scoreMax, qualThreshold, minReviews, blendAutoMode, blendOverride, tierLow, tierHigh, enrichThreshold, followUpMax, whatsappLimit, emailLimit]);

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

      {/* ── Deterministic/AI Blend Override ───────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Deterministic / AI Blend</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Override the automatic blend between rule-based scoring and AI scoring.
          Auto mode adjusts as the ML model improves.
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={blendAutoMode}
              onClick={() => setBlendAutoMode(!blendAutoMode)}
              className={cn(
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                blendAutoMode ? 'bg-zbooni-green' : 'bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform',
                  blendAutoMode ? 'translate-x-5' : 'translate-x-0',
                )}
              />
            </button>
            <span className="text-sm font-medium">Auto mode</span>
          </label>

          {blendAutoMode ? (
            <p className="text-xs text-muted-foreground/60">
              System decides automatically: 90/10 (no model) &rarr; 70/30 (decent model) &rarr; 50/50 (strong model).
            </p>
          ) : (
            <div className="max-w-xs space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground/60">
                <span>Rules</span>
                <span>AI</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={blendOverride}
                onChange={(e) => setBlendOverride(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-zbooni-teal"
              />
              <p className="text-center text-sm tabular-nums text-muted-foreground">
                {blendOverride}% deterministic / {100 - blendOverride}% AI
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Score Tier Bands ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Score Tier Bands</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Adjust where LOW / MEDIUM / HIGH score bands are drawn.
          Leads below LOW get minimal attention, above HIGH get full enrichment.
        </p>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground/70">LOW threshold</label>
            <input
              type="text"
              inputMode="decimal"
              value={tierLow}
              onChange={(e) => { setTierLow(e.target.value); setTierLowError(validateDecimalScore(e.target.value)); setTierRangeError(null); }}
              placeholder="0.34"
              className={cn(
                'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                tierLowError ? 'border-red-500/50' : 'border-border/50',
              )}
            />
            {tierLowError ? <p className="mt-1 text-[10px] text-red-400">{tierLowError}</p> : null}
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground/70">HIGH threshold</label>
            <input
              type="text"
              inputMode="decimal"
              value={tierHigh}
              onChange={(e) => { setTierHigh(e.target.value); setTierHighError(validateDecimalScore(e.target.value)); setTierRangeError(null); }}
              placeholder="0.67"
              className={cn(
                'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                tierHighError ? 'border-red-500/50' : 'border-border/50',
              )}
            />
            {tierHighError ? <p className="mt-1 text-[10px] text-red-400">{tierHighError}</p> : null}
          </div>
        </div>
        {tierRangeError ? <p className="mt-2 text-[10px] text-red-400">{tierRangeError}</p> : null}
      </div>

      {/* ── Enrichment Threshold ────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Enrichment Threshold</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Minimum score before spending money on Apollo contact enrichment.
          Leads below this skip paid enrichment to save costs.
        </p>
        <div className="max-w-xs">
          <input
            type="text"
            inputMode="decimal"
            value={enrichThreshold}
            onChange={(e) => { setEnrichThreshold(e.target.value); setEnrichError(validateDecimalScore(e.target.value)); }}
            placeholder="0.3"
            className={cn(
              'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
              enrichError ? 'border-red-500/50' : 'border-border/50',
            )}
          />
          {enrichError ? <p className="mt-1 text-[10px] text-red-400">{enrichError}</p> : null}
        </div>
      </div>

      {/* ── Follow-up Max Count ─────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Follow-up Max Count</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Maximum follow-up messages per lead before marking them cold.
          Higher values are more persistent but risk annoying leads.
        </p>
        <div className="max-w-xs">
          <input
            type="text"
            inputMode="numeric"
            value={followUpMax}
            onChange={(e) => { setFollowUpMax(e.target.value); setFollowUpError(validatePositiveInt(e.target.value)); }}
            placeholder="3"
            className={cn(
              'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
              followUpError ? 'border-red-500/50' : 'border-border/50',
            )}
          />
          {followUpError ? <p className="mt-1 text-[10px] text-red-400">{followUpError}</p> : null}
        </div>
      </div>

      {/* ── Daily Send Limits ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zbooni-teal" />
          <h2 className="text-base font-bold tracking-tight">Daily Send Limits</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground/60">
          Maximum messages sent per day per channel.
          Prevents throttling and keeps sender reputation healthy.
        </p>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground/70">WhatsApp</label>
            <input
              type="text"
              inputMode="numeric"
              value={whatsappLimit}
              onChange={(e) => { setWhatsappLimit(e.target.value); setWhatsappLimitError(validatePositiveInt(e.target.value)); }}
              placeholder="50"
              className={cn(
                'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                whatsappLimitError ? 'border-red-500/50' : 'border-border/50',
              )}
            />
            {whatsappLimitError ? <p className="mt-1 text-[10px] text-red-400">{whatsappLimitError}</p> : null}
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground/70">Email</label>
            <input
              type="text"
              inputMode="numeric"
              value={emailLimit}
              onChange={(e) => { setEmailLimit(e.target.value); setEmailLimitError(validatePositiveInt(e.target.value)); }}
              placeholder="100"
              className={cn(
                'h-9 w-full rounded-lg border bg-zbooni-dark/40 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20',
                emailLimitError ? 'border-red-500/50' : 'border-border/50',
              )}
            />
            {emailLimitError ? <p className="mt-1 text-[10px] text-red-400">{emailLimitError}</p> : null}
          </div>
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
