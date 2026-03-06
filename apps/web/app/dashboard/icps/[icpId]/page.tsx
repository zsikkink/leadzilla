'use client';

import {
  ArrowLeft,
  BarChart3,
  Check,
  DollarSign,
  Lightbulb,
  MessageSquare,
  Pencil,
  Plus,
  Shield,
  Star,
  Target,
  Trash2,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (val: string) => void;
  multiline?: boolean | undefined;
}

function EditableField({ label, value, onSave, multiline }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const save = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (editing) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
        <div className="mt-1 flex items-start gap-1.5">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              className="flex-1 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
            />
          )}
          <button type="button" onClick={save} className="rounded-lg p-1.5 text-zbooni-green hover:bg-zbooni-green/10">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={cancel} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <div className="mt-0.5 flex items-start gap-1.5">
        <p className={multiline ? 'font-medium whitespace-pre-line leading-relaxed' : 'font-medium'}>
          {value || <span className="text-muted-foreground/40 italic">Not set</span>}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

interface EditableTagsProps {
  label: string;
  tags: string[];
  onSave: (tags: string[]) => void;
  tagClassName?: string | undefined;
}

function EditableTags({ label, tags, onSave, tagClassName }: EditableTagsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  const [newTag, setNewTag] = useState('');

  const addTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !draft.includes(trimmed)) {
      setDraft([...draft, trimmed]);
      setNewTag('');
    }
  };
  const removeTag = (tag: string) => setDraft(draft.filter((t) => t !== tag));
  const save = () => { onSave(draft); setEditing(false); };
  const cancel = () => { setDraft(tags); setNewTag(''); setEditing(false); };

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</p>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {(editing ? draft : tags).map((tag) => (
          <span key={tag} className={`rounded-full px-2 py-0.5 text-xs ${tagClassName ?? 'bg-zbooni-dark/60 text-muted-foreground'}`}>
            {tag}
            {editing ? (
              <button type="button" onClick={() => removeTag(tag)} className="ml-1 hover:text-red-400">
                <X className="inline h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        ))}
        {tags.length === 0 && !editing ? (
          <span className="text-xs text-muted-foreground/40 italic">None</span>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Add tag..."
            className="h-7 w-36 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
          />
          <button type="button" onClick={addTag} className="rounded-lg p-1 text-zbooni-teal hover:bg-zbooni-teal/10">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={save} className="rounded-lg p-1 text-zbooni-green hover:bg-zbooni-green/10">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={cancel} className="rounded-lg p-1 text-muted-foreground hover:bg-accent/50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Helper to extract metadata fields from ICP
interface IcpMeta {
  priority?: string | undefined;
  avgTicket?: string | undefined;
  volumePotential?: string | undefined;
  salesCycle?: string | undefined;
  opsComplexity?: string | undefined;
  revenuePotential?: string | undefined;
  hook?: string | undefined;
  angle?: string[] | undefined;
}

function extractMeta(metadataJson: Record<string, unknown> | null | undefined): IcpMeta {
  if (!metadataJson) return {};
  const m = metadataJson as Record<string, unknown>;
  return {
    priority: typeof m.priority === 'string' ? m.priority : undefined,
    avgTicket: typeof m.avgTicket === 'string' ? m.avgTicket : undefined,
    volumePotential: typeof m.volumePotential === 'string' ? m.volumePotential : undefined,
    salesCycle: typeof m.salesCycle === 'string' ? m.salesCycle : undefined,
    opsComplexity: typeof m.opsComplexity === 'string' ? m.opsComplexity : undefined,
    revenuePotential: typeof m.revenuePotential === 'string' ? m.revenuePotential : undefined,
    hook: typeof m.hook === 'string' ? m.hook : undefined,
    angle: Array.isArray(m.angle) ? (m.angle as string[]) : undefined,
  };
}

export default function IcpDetailPage() {
  const { icpId } = useParams<{ icpId: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.deleteIcp(icpId);
      toast.success('ICP profile deleted');
      router.push('/dashboard/icps');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete ICP profile');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const icp = useApiQuery(
    useCallback(() => apiClient.getIcp(icpId), [apiClient, icpId]),
    [icpId],
  );
  const icpFunnel = useApiQuery(
    useCallback(() => apiClient.getFunnel({ icpProfileId: icpId }), [apiClient, icpId]),
    [icpId],
  );
  const icpFeedback = useApiQuery(
    useCallback(() => apiClient.getFeedbackSummary({ icpProfileId: icpId }), [apiClient, icpId]),
    [icpId],
  );
  const icpScoreDistribution = useApiQuery(
    useCallback(() => apiClient.getScoreDistribution({ icpProfileId: icpId }), [apiClient, icpId]),
    [icpId],
  );

  const handleUpdate = async (field: string, value: unknown) => {
    setSaving(true);
    try {
      await apiClient.updateIcp(icpId, { [field]: value });
      icp.refetch();
    } catch {
      // silently fail for now
    } finally {
      setSaving(false);
    }
  };

  if (icp.error) {
    return <p className="text-sm text-destructive">{icp.error}</p>;
  }

  if (icp.isLoading || !icp.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        Loading ICP profile...
      </div>
    );
  }

  const profile = icp.data;
  const meta = extractMeta(profile.metadataJson);
  const leadsDiscovered = icpFunnel.data?.discoveredCount ?? 0;
  const leadsQualified = icpFunnel.data?.qualifiedCount ?? 0;
  const messagesSent = icpFunnel.data?.messagesSentCount ?? 0;
  const replies = icpFeedback.data?.repliedCount ?? 0;
  const conversionRate = leadsDiscovered > 0 ? leadsQualified / leadsDiscovered : 0;
  const replyRate = messagesSent > 0 ? replies / messagesSent : 0;
  const costPerLead = icpFunnel.data?.costPerLead ?? 0;
  const totalCostCents = icpFunnel.data?.totalCostCents ?? 0;
  const scoreBands = icpScoreDistribution.data?.bands ?? [];
  const scoreTotal = scoreBands.reduce((sum, band) => sum + band.count, 0);
  const scoreWeighted = scoreBands.reduce((sum, band) => {
    if (band.scoreBand === 'LOW') {
      return sum + band.count * 0.2;
    }
    if (band.scoreBand === 'MEDIUM') {
      return sum + band.count * 0.55;
    }
    return sum + band.count * 0.85;
  }, 0);
  const avgScore = scoreTotal > 0 ? scoreWeighted / scoreTotal : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to ICPs
        </button>
        {saving ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
            Saving...
          </span>
        ) : null}
      </div>

      {/* Profile header */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <EditableField label="" value={profile.name} onSave={(val) => handleUpdate('name', val)} />
              {meta.priority ? (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  meta.priority === 'P1' ? 'bg-zbooni-green/15 text-zbooni-green' : 'bg-zbooni-teal/15 text-zbooni-teal'
                }`}>
                  {meta.priority}
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              <EditableField
                label="Description"
                value={profile.description ?? ''}
                onSave={(val) => handleUpdate('description', val)}
                multiline
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate('isActive', !profile.isActive)}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              profile.isActive
                ? 'bg-zbooni-green/15 text-zbooni-green hover:bg-zbooni-green/25'
                : 'bg-gray-500/15 text-gray-400 hover:bg-gray-500/25'
            }`}
          >
            {profile.isActive ? 'Active' : 'Inactive'}
          </button>
        </div>

        {/* Hook & Angle from metadata */}
        {meta.hook ? (
          <div className="mt-4 rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/5 p-4">
            <div className="flex items-start gap-2">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-zbooni-teal" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-zbooni-teal/70">Sales Hook</p>
                <p className="mt-0.5 text-sm italic text-muted-foreground">&ldquo;{meta.hook}&rdquo;</p>
              </div>
            </div>
            {meta.angle ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {meta.angle.map((a) => (
                  <span key={a} className="rounded-full bg-zbooni-teal/10 px-2.5 py-0.5 text-xs text-zbooni-teal">
                    {a}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <EditableTags
            label="Target Industries"
            tags={profile.targetIndustries}
            onSave={(val) => handleUpdate('targetIndustries', val)}
          />
          <EditableTags
            label="Target Countries"
            tags={profile.targetCountries}
            onSave={(val) => handleUpdate('targetCountries', val)}
            tagClassName="bg-zbooni-teal/10 text-zbooni-teal"
          />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Logic</p>
            <p className="mt-1.5 font-medium">{profile.qualificationLogic}</p>
          </div>
        </div>

        {/* ICP Scoring from metadata */}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          {meta.avgTicket ? (
            <div className="rounded-lg border border-border/30 bg-zbooni-dark/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Avg Ticket</p>
              <p className="mt-0.5 text-xs font-medium">{meta.avgTicket}</p>
            </div>
          ) : null}
          {meta.volumePotential ? (
            <div className="rounded-lg border border-border/30 bg-zbooni-dark/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Volume</p>
              <p className="mt-0.5 text-xs font-medium">{meta.volumePotential}</p>
            </div>
          ) : null}
          {meta.salesCycle ? (
            <div className="rounded-lg border border-border/30 bg-zbooni-dark/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Sales Cycle</p>
              <p className="mt-0.5 text-xs font-medium">{meta.salesCycle}</p>
            </div>
          ) : null}
          {meta.opsComplexity ? (
            <div className="rounded-lg border border-border/30 bg-zbooni-dark/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Ops Complexity</p>
              <p className="mt-0.5 text-xs font-medium">{meta.opsComplexity}</p>
            </div>
          ) : null}
          {meta.revenuePotential ? (
            <div className="rounded-lg border border-border/30 bg-zbooni-dark/30 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Revenue</p>
              <p className="mt-0.5 text-xs font-medium">{meta.revenuePotential}</p>
            </div>
          ) : null}
        </div>

        {/* Extra fields */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <EditableField
            label="Min Company Size"
            value={profile.minCompanySize !== null ? String(profile.minCompanySize) : ''}
            onSave={(val) => handleUpdate('minCompanySize', val ? parseInt(val, 10) : null)}
          />
          <EditableField
            label="Max Company Size"
            value={profile.maxCompanySize !== null ? String(profile.maxCompanySize) : ''}
            onSave={(val) => handleUpdate('maxCompanySize', val ? parseInt(val, 10) : null)}
          />
          <EditableTags
            label="Required Tech"
            tags={profile.requiredTechnologies}
            onSave={(val) => handleUpdate('requiredTechnologies', val)}
            tagClassName="bg-purple-500/10 text-purple-400"
          />
          <EditableTags
            label="Excluded Domains"
            tags={profile.excludedDomains}
            onSave={(val) => handleUpdate('excludedDomains', val)}
            tagClassName="bg-red-500/10 text-red-400"
          />
        </div>
      </div>

      {/* Performance Stats */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-zbooni-green" />
          Performance Stats (Live)
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 text-center">
            <p className="text-2xl font-extrabold tracking-tight">{leadsDiscovered}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Discovered</p>
          </div>
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 text-center">
            <p className="text-2xl font-extrabold tracking-tight">{leadsQualified}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Qualified</p>
          </div>
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 text-center">
            <p className="text-2xl font-extrabold tracking-tight">{messagesSent}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Messaged</p>
          </div>
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/40 p-4 text-center">
            <p className="text-2xl font-extrabold tracking-tight text-zbooni-green">{replies}</p>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Replies</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <TrendingUp className="h-4 w-4 text-zbooni-green" />
            <div>
              <p className="text-sm font-bold">{Math.round(conversionRate * 100)}%</p>
              <p className="text-[10px] text-muted-foreground/50">Conversion</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <MessageSquare className="h-4 w-4 text-zbooni-teal" />
            <div>
              <p className="text-sm font-bold">{Math.round(replyRate * 100)}%</p>
              <p className="text-[10px] text-muted-foreground/50">Reply Rate</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <Target className="h-4 w-4 text-yellow-400" />
            <div>
              <p className="text-sm font-bold">{Math.round(avgScore * 100)}</p>
              <p className="text-[10px] text-muted-foreground/50">Avg Score</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <Star className="h-4 w-4 text-amber-400" />
            <div>
              <p className="text-sm font-bold truncate">{icpFunnel.data?.meetingsCount ?? 0}</p>
              <p className="text-[10px] text-muted-foreground/50">Meetings</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <Zap className="h-4 w-4 text-emerald-400" />
            <div>
              <p className="text-sm font-bold">{icpFunnel.data?.dealsWonCount ?? 0}</p>
              <p className="text-[10px] text-muted-foreground/50">Deals Won</p>
            </div>
          </div>
        </div>

        {/* Cost per lead */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <DollarSign className="h-4 w-4 text-amber-400" />
            <div>
              <p className="text-sm font-bold">${costPerLead.toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground/50">Cost / Lead</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-zbooni-dark/30 p-3">
            <DollarSign className="h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-bold">${(totalCostCents / 100).toFixed(2)}</p>
              <p className="text-[10px] text-muted-foreground/50">Total Spend</p>
            </div>
          </div>
        </div>
      </div>

      {/* Features to Pitch — from featureList stored on ICP profile */}
      {(() => {
        const features = profile.featureList ?? [];
        if (features.length === 0) return null;
        return (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              Features to Pitch
              <span className="ml-auto text-xs font-normal text-muted-foreground">{features.length} features</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature}
                  className="flex items-center gap-3 rounded-xl border border-border/30 bg-slate-800 p-3"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-yellow-400/10">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                  </div>
                  <p className="text-sm font-medium">{feature}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Scoring Rules — mirrors actual UNIVERSAL_RULES from scoring engine */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-4 w-4 text-zbooni-teal" />
          Scoring Rules
          <span className="ml-auto text-xs font-normal text-muted-foreground">Universal rules — same for all ICPs</span>
        </h2>

        {/* Hard Filters */}
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-400/80">Hard Filters (must all pass)</h3>
          <div className="space-y-1.5">
            {[
              { field: 'country', rule: 'IN [UAE, KSA, Jordan, Egypt, Bahrain, Kuwait, Oman, Qatar]' },
              { field: 'has_email', rule: 'Must have email contact' },
              { field: 'data_alignment_score', rule: '>= 0.3 (cross-source validation)' },
              { field: 'pure_self_serve_ecom', rule: 'NEQ true (disqualify pure self-serve ecommerce)' },
              { field: 'subscription_billing_detected', rule: 'NEQ true (disqualify subscription/recurring billing)' },
            ].map((r) => (
              <div key={r.field} className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <span className="font-mono text-[11px] font-semibold text-red-400">{r.field}</span>
                <span className="text-[11px] text-muted-foreground/60">{r.rule}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Positive Weighted Rules */}
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zbooni-green/80">Positive Signals (total weight: 26)</h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {[
              { field: 'has_whatsapp', label: 'WhatsApp presence', weight: 3 },
              { field: 'industry_supported', label: 'Industry match', weight: 3 },
              { field: 'has_instagram', label: 'Instagram presence', weight: 2 },
              { field: 'review_count', label: 'Reviews > 10', weight: 2 },
              { field: 'custom_order_signals', label: 'Custom order signals', weight: 2 },
              { field: 'has_booking_or_contact_form', label: 'Booking/contact form', weight: 2 },
              { field: 'high_ticket_signals', label: 'High-ticket signals', weight: 2 },
              { field: 'deposit_milestone_signals', label: 'Deposit/milestone payments', weight: 2 },
              { field: 'bank_transfer_reliance', label: 'Bank transfer reliance', weight: 2 },
              { field: 'icp_segment_priority', label: 'P1 priority segment', weight: 2 },
              { field: 'recent_activity', label: 'Recent activity', weight: 1 },
              { field: 'apify_payment_widget_count', label: 'Payment widgets', weight: 1 },
              { field: 'apify_has_pricing_tiers', label: 'Has pricing tiers', weight: 1 },
              { field: 'social_link_count', label: 'Multiple social profiles', weight: 1 },
              { field: 'instagram_has_business_email', label: 'IG business email', weight: 1 },
            ].map((r) => (
              <div key={r.field} className="flex items-center justify-between rounded-lg border border-zbooni-green/20 bg-zbooni-green/5 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-[11px] font-medium">{r.label}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{r.field}</span>
                </div>
                <span className="shrink-0 rounded bg-zbooni-green/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zbooni-green">+{r.weight}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Category Bonus System */}
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-purple-400/80">Category Bonus System</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { cat: 'Sales Motion Fit', fields: 'whatsapp, instagram, custom orders, decision makers' },
              { cat: 'Payment Complexity', fields: 'payment widgets, pricing tiers, high-ticket, deposits, bank transfer' },
              { cat: 'Risk & Urgency', fields: 'recent activity, booking form, contact info' },
              { cat: 'Switching Willingness', fields: 'social links, linkedin, tech stack, IG engagement' },
              { cat: 'General', fields: 'industry match, geo match, ICP priority' },
            ].map((c) => (
              <div key={c.cat} className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
                <p className="text-[11px] font-semibold text-purple-400">{c.cat}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/50">{c.fields}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground/50">
            <span><strong className="text-zbooni-green">PROCEED</strong> (Sales + Payment + 3+ cats): +10% bonus</span>
            <span><strong className="text-zbooni-teal">SELECTIVE</strong> (2+ cats): +5% bonus</span>
            <span><strong className="text-red-400">DISQUALIFY</strong> (&lt;2 cats): -15% penalty</span>
          </div>
        </div>

        {/* Tier Bands */}
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">Score Tier Bands</h3>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-red-500/15 px-2 py-1 text-[10px] font-bold text-red-400">LOW &lt; 0.34</span>
            <span className="rounded-md bg-yellow-500/15 px-2 py-1 text-[10px] font-bold text-yellow-400">0.34 &le; MED &lt; 0.67</span>
            <span className="rounded-md bg-zbooni-green/15 px-2 py-1 text-[10px] font-bold text-zbooni-green">HIGH &ge; 0.67</span>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/40">
            Blend: 90% rules / 10% ML (no model) → 70/30 (AUC≥0.70, 200+ samples) → 50/50 (AUC≥0.80, 500+ samples)
          </p>
        </div>
      </div>

      {/* Danger Zone — Delete ICP */}
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-red-400">Danger Zone</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Permanently delete this ICP profile. This action cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition-all hover:bg-red-700 hover:shadow-red-600/30"
          >
            <Trash2 className="h-4 w-4" />
            Delete ICP Profile
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteConfirm(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-icp-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-red-500/30 bg-card p-8 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h2 id="delete-icp-title" className="text-lg font-extrabold tracking-tight">
                  Delete ICP Profile
                </h2>
                <p className="text-sm text-muted-foreground">
                  This will permanently remove &ldquo;{profile.name}&rdquo;
                </p>
              </div>
            </div>

            <p className="mb-6 text-sm text-muted-foreground">
              All associated qualification rules, scoring data, and message history linked to this ICP will be affected. This action cannot be undone.
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-input text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white shadow-lg shadow-red-600/20 transition-all hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Deleting...
                  </span>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Yes, Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
