'use client';

import type {
  IcpProfileResponse,
  QualificationRuleResponse,
} from '@lead-flood/contracts';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Info,
  Lightbulb,
  Loader2,
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
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomSelect } from '../../../../src/components/custom-select.js';
import { useApiQuery } from '../../../../src/hooks/use-api-query.js';
import { useAuth } from '../../../../src/hooks/use-auth.js';
import { countryName } from '../../../../src/lib/countries.js';

interface EditableFieldProps {
  label: string;
  value: string;
  onSave: (val: string) => Promise<boolean>;
  multiline?: boolean | undefined;
  textClassName?: string | undefined;
}

function EditableField({ label, value, onSave, multiline, textClassName }: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  const save = async () => {
    setIsSaving(true);
    try {
      const saved = await onSave(draft);
      if (saved) {
        setEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  };
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
              disabled={isSaving}
              onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            />
          ) : (
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              disabled={isSaving}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') cancel();
              }}
            />
          )}
          <button type="button" onClick={() => void save()} disabled={isSaving} className="rounded-lg p-1.5 text-zbooni-green hover:bg-zbooni-green/10 disabled:opacity-50">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={cancel} disabled={isSaving} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 disabled:opacity-50">
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
        <p className={textClassName ?? (multiline ? 'font-medium whitespace-pre-line leading-relaxed' : 'font-medium')}>
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
  onSave: (tags: string[]) => Promise<boolean>;
  tagClassName?: string | undefined;
}

function EditableTags({ label, tags, onSave, tagClassName }: EditableTagsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tags);
  const [newTag, setNewTag] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(tags);
      setNewTag('');
    }
  }, [editing, tags]);

  const addTag = () => {
    const trimmed = newTag.trim();
    if (trimmed && !draft.includes(trimmed)) {
      setDraft([...draft, trimmed]);
      setNewTag('');
    }
  };
  const removeTag = (tag: string) => setDraft(draft.filter((t) => t !== tag));
  const save = async () => {
    setIsSaving(true);
    try {
      const saved = await onSave(draft);
      if (saved) {
        setEditing(false);
      }
    } finally {
      setIsSaving(false);
    }
  };
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
            disabled={isSaving}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" onClick={addTag} disabled={isSaving} className="rounded-lg p-1 text-zbooni-teal hover:bg-zbooni-teal/10 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void save()} disabled={isSaving} className="rounded-lg p-1 text-zbooni-green hover:bg-zbooni-green/10 disabled:opacity-50">
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={cancel} disabled={isSaving} className="rounded-lg p-1 text-muted-foreground hover:bg-accent/50 disabled:opacity-50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CountrySelector({
  countries,
  onSave,
  pipelineCountries,
}: {
  countries: string[];
  onSave: (countries: string[]) => Promise<boolean>;
  pipelineCountries: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(countries);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(countries);
    }
  }, [editing, countries]);

  // Countries come from pipeline_settings (Controls & Settings page) — the single source of truth
  const available = pipelineCountries
    .filter((c) => !draft.includes(c))
    .sort((left, right) => countryName(left).localeCompare(countryName(right)));

  const remove = (country: string) => setDraft(draft.filter((c) => c !== country));

  const add = (country: string) => {
    if (country && !draft.includes(country)) {
      setDraft([...draft, country]);
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const saved = await onSave(draft);
      if (saved) setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const cancel = () => { setDraft(countries); setEditing(false); };

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Target Countries</p>
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
        {(editing ? draft : countries).map((c) => (
          <span key={c} className="rounded-full bg-zbooni-teal/10 px-2 py-0.5 text-xs text-zbooni-teal">
            {countryName(c)}
            {editing ? (
              <button type="button" onClick={() => remove(c)} className="ml-1 hover:text-red-400">
                <X className="inline h-2.5 w-2.5" />
              </button>
            ) : null}
          </span>
        ))}
        {countries.length === 0 && !editing ? (
          <span className="text-xs text-muted-foreground/40 italic">None</span>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          {available.length > 0 ? (
            <CustomSelect
              value=""
              onChange={(val) => { if (val) add(val); }}
              options={available.map((c) => ({ value: c, label: countryName(c) }))}
              placeholder="Add country..."
              className="w-48"
            />
          ) : (
            <p className="text-[10px] text-muted-foreground/50 italic">
              All countries assigned. Add more in Controls & Settings.
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => void save()} disabled={isSaving} className="rounded-lg p-1 text-zbooni-green hover:bg-zbooni-green/10 disabled:opacity-50">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={cancel} disabled={isSaving} className="rounded-lg p-1 text-muted-foreground hover:bg-accent/50 disabled:opacity-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FeaturePitchEditor({
  features,
  onSave,
}: {
  features: string[];
  onSave: (features: string[]) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(features);
  const [newFeature, setNewFeature] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(features);
      setNewFeature('');
    }
  }, [editing, features]);

  const add = () => {
    const trimmed = newFeature.trim();
    if (trimmed && !draft.includes(trimmed)) {
      setDraft([...draft, trimmed]);
      setNewFeature('');
    }
  };

  const remove = (feature: string) => setDraft(draft.filter((f) => f !== feature));

  const save = async () => {
    setIsSaving(true);
    try {
      const saved = await onSave(draft);
      if (saved) setEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const cancel = () => { setDraft(features); setNewFeature(''); setEditing(false); };
  const items = editing ? draft : features;

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-yellow-400" />
        <h2 className="text-base font-bold tracking-tight">Features to Pitch</h2>
        <span className="ml-auto text-xs font-normal text-muted-foreground">{items.length} items</span>
        {!editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
          >
            <Pencil className="inline h-3 w-3" />
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((feature) => (
            <div
              key={feature}
              className="flex items-start gap-2.5 rounded-xl border border-yellow-400/20 bg-yellow-400/5 px-3.5 py-2.5"
            >
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-400" />
              <span className="text-sm leading-snug">{feature}</span>
              {editing ? (
                <button
                  type="button"
                  onClick={() => remove(feature)}
                  className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/50 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/40 italic">No features added yet.</p>
      )}

      {editing ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={newFeature}
              onChange={(e) => setNewFeature(e.target.value)}
              placeholder="Add a feature..."
              className="h-8 flex-1 rounded-lg border border-border/50 bg-zbooni-dark/60 px-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              disabled={isSaving}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              type="button"
              onClick={add}
              disabled={isSaving || !newFeature.trim()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/50 px-3 text-xs font-medium text-zbooni-teal transition-colors hover:bg-zbooni-teal/10 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={isSaving}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zbooni-teal px-4 text-xs font-semibold text-zbooni-dark transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={isSaving}
              className="inline-flex h-8 items-center rounded-lg border border-border/50 px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Industry key normalization ─────────────────────
function industryKey(name: string): string {
  return name.toLowerCase().trim().replaceAll(' ', '_');
}

// ── Category Overrides type ────────────────────────
interface CategoryOverrides {
  [industryKey: string]: {
    add?: string[] | undefined;
    remove?: string[] | undefined;
  };
}

// ── IndustryMappingEditor ──────────────────────────
interface IndustryMapping {
  industry: string;
  categories: string[];
  source: 'mapped' | 'fuzzy' | 'direct';
}

interface IndustryMappingEditorProps {
  industries: string[];
  metadataJson: Record<string, unknown> | null | undefined;
  onSaveIndustries: (industries: string[]) => void;
  onSaveMetadata: (meta: Record<string, unknown>) => void;
  apiClient: { previewCategories: (industries: string[]) => Promise<{ mappings: IndustryMapping[] }> };
}

function IndustryMappingEditor({
  industries,
  metadataJson,
  onSaveIndustries,
  onSaveMetadata,
  apiClient,
}: IndustryMappingEditorProps) {
  const [mappings, setMappings] = useState<IndustryMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newIndustry, setNewIndustry] = useState('');
  const [addingIndustry, setAddingIndustry] = useState(false);
  const [newCategoryInputs, setNewCategoryInputs] = useState<Record<string, string>>({});

  // Read existing overrides from metadataJson
  const existingOverrides: CategoryOverrides =
    (metadataJson && typeof metadataJson === 'object' && 'categoryOverrides' in metadataJson
      ? (metadataJson as Record<string, unknown>).categoryOverrides as CategoryOverrides
      : null) ?? {};

  // Fetch mappings whenever industries change
  useEffect(() => {
    if (industries.length === 0) {
      setMappings([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    apiClient
      .previewCategories(industries)
      .then((result) => {
        if (!cancelled) {
          setMappings(result.mappings);
        }
      })
      .catch(() => {
        // silently fail — user sees empty categories
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [industries, apiClient]);

  // Apply overrides to get the effective categories for an industry
  function getEffectiveCategories(mapping: IndustryMapping): string[] {
    const key = industryKey(mapping.industry);
    const override = existingOverrides[key];
    let cats = [...mapping.categories];
    if (override?.remove) {
      cats = cats.filter((c) => !override.remove!.includes(c));
    }
    if (override?.add) {
      for (const a of override.add) {
        if (!cats.includes(a)) cats.push(a);
      }
    }
    return cats;
  }

  function toggleCollapse(industry: string) {
    setCollapsed((prev) => ({ ...prev, [industry]: !prev[industry] }));
  }

  function removeIndustry(industry: string) {
    const updated = industries.filter((i) => i !== industry);
    onSaveIndustries(updated);
    // Also clean up any overrides for this industry
    const key = industryKey(industry);
    if (existingOverrides[key]) {
      const newOverrides = { ...existingOverrides };
      delete newOverrides[key];
      onSaveMetadata({ ...(metadataJson ?? {}), categoryOverrides: newOverrides });
    }
  }

  function addIndustry() {
    const trimmed = newIndustry.trim();
    if (trimmed && !industries.includes(trimmed)) {
      onSaveIndustries([...industries, trimmed]);
      setNewIndustry('');
      setAddingIndustry(false);
    }
  }

  function removeCategory(industry: string, category: string) {
    const key = industryKey(industry);
    const mapping = mappings.find((m) => m.industry === industry);
    const baseCategories = mapping?.categories ?? [];
    const current = existingOverrides[key] ?? {};

    // If it's a base category, add to remove list
    if (baseCategories.includes(category)) {
      const removeList = [...(current.remove ?? [])];
      if (!removeList.includes(category)) removeList.push(category);
      const newOverrides: CategoryOverrides = {
        ...existingOverrides,
        [key]: { ...current, remove: removeList },
      };
      onSaveMetadata({ ...(metadataJson ?? {}), categoryOverrides: newOverrides });
    } else {
      // It's a user-added category — remove from add list
      const addList = (current.add ?? []).filter((a) => a !== category);
      const newOverrides: CategoryOverrides = {
        ...existingOverrides,
        [key]: { ...current, add: addList.length > 0 ? addList : undefined },
      };
      // Clean up empty override entries
      if (!newOverrides[key]?.add?.length && !newOverrides[key]?.remove?.length) {
        delete newOverrides[key];
      }
      onSaveMetadata({ ...(metadataJson ?? {}), categoryOverrides: newOverrides });
    }
  }

  function addCategory(industry: string) {
    const key = industryKey(industry);
    const input = (newCategoryInputs[industry] ?? '').trim();
    if (!input) return;

    const current = existingOverrides[key] ?? {};
    const effective = getEffectiveCategories(
      mappings.find((m) => m.industry === industry) ?? { industry, categories: [], source: 'direct' },
    );

    if (effective.includes(input)) return; // already exists

    // If it was previously removed, un-remove it
    const mapping = mappings.find((m) => m.industry === industry);
    const baseCategories = mapping?.categories ?? [];
    if (baseCategories.includes(input) && current.remove?.includes(input)) {
      const removeList = current.remove.filter((r) => r !== input);
      const newOverrides: CategoryOverrides = {
        ...existingOverrides,
        [key]: { ...current, remove: removeList.length > 0 ? removeList : undefined },
      };
      if (!newOverrides[key]?.add?.length && !newOverrides[key]?.remove?.length) {
        delete newOverrides[key];
      }
      onSaveMetadata({ ...(metadataJson ?? {}), categoryOverrides: newOverrides });
    } else {
      // Add as user-added category
      const addList = [...(current.add ?? []), input];
      const newOverrides: CategoryOverrides = {
        ...existingOverrides,
        [key]: { ...current, add: addList },
      };
      onSaveMetadata({ ...(metadataJson ?? {}), categoryOverrides: newOverrides });
    }

    setNewCategoryInputs((prev) => ({ ...prev, [industry]: '' }));
  }

  const sourceBadge = (source: 'mapped' | 'fuzzy' | 'direct') => {
    switch (source) {
      case 'mapped':
        return (
          <span className="inline-flex items-center rounded-full bg-zbooni-green/15 px-2 py-0.5 text-[10px] font-semibold text-zbooni-green">
            mapped
          </span>
        );
      case 'fuzzy':
        return (
          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
            approximate match
          </span>
        );
      case 'direct':
        return (
          <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
            searched as-is
          </span>
        );
    }
  };

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Target Industries & Search Categories
      </p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading category mappings...
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {mappings.map((mapping) => {
            const isCollapsed = collapsed[mapping.industry] === true;
            const effectiveCats = getEffectiveCategories(mapping);
            const key = industryKey(mapping.industry);
            const catInput = newCategoryInputs[mapping.industry] ?? '';
            // If user added search categories via overrides, treat as "mapped" regardless of API source
            const hasUserCategories = (existingOverrides[key]?.add?.length ?? 0) > 0;
            const effectiveSource = (mapping.source === 'direct' && hasUserCategories) ? 'mapped' as const : mapping.source;

            return (
              <div
                key={mapping.industry}
                className={`rounded-xl border p-3 transition-colors ${
                  effectiveSource === 'fuzzy'
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : effectiveSource === 'direct'
                      ? 'border-blue-500/30 bg-blue-500/5'
                      : 'border-border/50 bg-card'
                }`}
              >
                {/* Industry header row */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(mapping.industry)}
                    className="flex items-center gap-1.5 text-sm font-semibold transition-colors hover:text-zbooni-teal cursor-pointer"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                    )}
                    {mapping.industry}
                  </button>
                  {sourceBadge(effectiveSource)}
                  <span className="ml-auto text-[10px] text-muted-foreground/40">
                    {effectiveCats.length} {effectiveCats.length === 1 ? 'term' : 'terms'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeIndustry(mapping.industry)}
                    className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                    title="Remove industry"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {/* Expanded: categories + add input */}
                {!isCollapsed ? (
                  <div className="mt-2.5">
                    {effectiveCats.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {effectiveCats.map((cat) => {
                          const isUserAdded = existingOverrides[key]?.add?.includes(cat);
                          return (
                            <span
                              key={cat}
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${
                                isUserAdded
                                  ? 'bg-zbooni-teal/15 text-zbooni-teal'
                                  : 'bg-zbooni-dark/60 text-muted-foreground'
                              }`}
                            >
                              {cat}
                              <button
                                type="button"
                                onClick={() => removeCategory(mapping.industry, cat)}
                                className="ml-1.5 rounded-full transition-colors hover:text-red-400 cursor-pointer"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}

                    {/* Direct source hint — only show when no user-added categories exist */}
                    {effectiveSource === 'direct' ? (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] text-blue-400/70">
                        <Info className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          No mapping found — will search Google Maps directly for &ldquo;{mapping.industry} in {'{'}{' '}
                          city {'}'}&rdquo;
                        </span>
                      </div>
                    ) : null}

                    {/* Add category input */}
                    <div className="mt-2 flex items-center gap-1.5">
                      <input
                        value={catInput}
                        onChange={(e) =>
                          setNewCategoryInputs((prev) => ({ ...prev, [mapping.industry]: e.target.value }))
                        }
                        placeholder="Add search term..."
                        className="h-7 w-44 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addCategory(mapping.industry);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => addCategory(mapping.industry)}
                        className="rounded-lg p-1 text-zbooni-teal transition-colors hover:bg-zbooni-teal/10 cursor-pointer"
                        title="Add search term"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Industries with no mapping yet (if industries exist but API hasn't returned) */}
          {!loading && industries.length === 0 ? (
            <p className="text-xs text-muted-foreground/40 italic">No industries configured</p>
          ) : null}
        </div>
      )}

      {/* Add Industry button / input */}
      <div className="mt-3">
        {addingIndustry ? (
          <div className="flex items-center gap-1.5">
            <input
              value={newIndustry}
              onChange={(e) => setNewIndustry(e.target.value)}
              placeholder="Industry name..."
              className="h-8 w-52 rounded-lg border border-border/50 bg-zbooni-dark/60 px-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') addIndustry();
                if (e.key === 'Escape') {
                  setAddingIndustry(false);
                  setNewIndustry('');
                }
              }}
            />
            <button
              type="button"
              onClick={addIndustry}
              className="rounded-lg p-1.5 text-zbooni-green transition-colors hover:bg-zbooni-green/10 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingIndustry(false);
                setNewIndustry('');
              }}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent/50 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingIndustry(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zbooni-teal transition-colors hover:bg-zbooni-teal/10 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Industry
          </button>
        )}
      </div>
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
  salesHook?: string | undefined;
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
    salesHook: typeof m.salesHook === 'string' ? m.salesHook : undefined,
    hook: typeof m.hook === 'string' ? m.hook : undefined,
    angle: Array.isArray(m.angle) ? (m.angle as string[]) : undefined,
  };
}

// A4: Editable rules section with inline weight editing
function IcpRulesSection({
  profile,
  onRulesChanged,
}: {
  profile: IcpProfileResponse;
  apiClient: { getIcpRules: (icpId: string) => Promise<{ items: QualificationRuleResponse[] }> };
  onRulesChanged: () => void;
}) {
  const { token } = useAuth();
  const rules = profile.qualificationRules ?? [];
  const [editingWeights, setEditingWeights] = useState<Record<string, number>>({});
  const [savingWeightId, setSavingWeightId] = useState<string | null>(null);

  const hardFilters = rules.filter((r) => r.ruleType === 'HARD_FILTER');
  const positiveRules = rules.filter((r) => r.ruleType === 'WEIGHTED' && (r.weight ?? 0) >= 0);
  const negativeRules = rules.filter((r) => r.ruleType === 'WEIGHTED' && (r.weight ?? 0) < 0);
  const totalPositiveWeight = positiveRules.reduce((sum, r) => sum + (r.weight ?? 0), 0);

  const saveWeight = async (ruleId: string, newWeight: number) => {
    setSavingWeightId(ruleId);
    try {
      const env = await import('../../../../src/lib/env.js');
      const res = await fetch(
        `${env.getWebEnv().NEXT_PUBLIC_API_BASE_URL}/v1/icps/${profile.id}/rules/${ruleId}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ weight: newWeight }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      toast.success('Weight updated');
      setEditingWeights((prev) => { const next = { ...prev }; delete next[ruleId]; return next; });
      onRulesChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update weight');
    } finally {
      setSavingWeightId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <h2 className="mb-4 text-base font-bold tracking-tight flex items-center gap-2">
        <Shield className="h-4 w-4 text-zbooni-teal" />
        Qualification Rules
        <span className="ml-auto text-xs font-normal text-muted-foreground">{rules.length} rules</span>
      </h2>

      {/* Hard Filters */}
      {hardFilters.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-red-400/80">Hard Filters (must all pass)</h3>
          <div className="space-y-1.5">
            {hardFilters.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                <span className="font-mono text-[11px] font-semibold text-red-400">{r.fieldKey}</span>
                <span className="text-[11px] text-muted-foreground/60">{r.operator} {typeof r.valueJson === 'string' ? r.valueJson : JSON.stringify(r.valueJson)}</span>
                <span className="ml-auto font-mono text-[10px] text-red-400">REQUIRED</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Positive Weighted Rules with editable weights (A4) */}
      {positiveRules.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zbooni-green/80">
            Positive Signals (total weight: {totalPositiveWeight})
          </h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {positiveRules.map((r) => {
              const isEditing = r.id in editingWeights;
              const currentWeight = isEditing ? (editingWeights[r.id] ?? r.weight ?? 0) : (r.weight ?? 0);

              return (
                <div key={r.id} className="group flex items-center justify-between rounded-lg border border-zbooni-green/20 bg-zbooni-green/5 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium">{r.name}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{r.fieldKey}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isEditing ? (
                      <>
                        <input
                          type="number"
                          min={-10}
                          max={10}
                          step={0.5}
                          value={currentWeight}
                          onChange={(e) => setEditingWeights((prev) => ({ ...prev, [r.id]: Number(e.target.value) || 0 }))}
                          className="h-6 w-14 rounded border border-border/50 bg-zbooni-dark/60 px-1.5 text-center font-mono text-[10px] tabular-nums focus:border-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void saveWeight(r.id, currentWeight)}
                          disabled={savingWeightId === r.id}
                          className="rounded p-0.5 text-zbooni-green hover:bg-zbooni-green/10 disabled:opacity-50"
                        >
                          {savingWeightId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWeights((prev) => { const next = { ...prev }; delete next[r.id]; return next; })}
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent/50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingWeights((prev) => ({ ...prev, [r.id]: r.weight ?? 0 }))}
                        className="rounded bg-zbooni-green/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zbooni-green transition-colors hover:bg-zbooni-green/25"
                        title="Click to edit weight"
                      >
                        +{(r.weight ?? 0)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Negative (Anti-fit) Rules */}
      {negativeRules.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-orange-400/80">Anti-fit Signals</h3>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {negativeRules.map((r) => {
              const isEditing = r.id in editingWeights;
              const currentWeight = isEditing ? (editingWeights[r.id] ?? r.weight ?? 0) : (r.weight ?? 0);

              return (
                <div key={r.id} className="group flex items-center justify-between rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-[11px] font-medium">{r.name}</span>
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/40">{r.fieldKey}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {isEditing ? (
                      <>
                        <input
                          type="number"
                          min={-10}
                          max={10}
                          step={0.5}
                          value={currentWeight}
                          onChange={(e) => setEditingWeights((prev) => ({ ...prev, [r.id]: Number(e.target.value) || 0 }))}
                          className="h-6 w-14 rounded border border-border/50 bg-zbooni-dark/60 px-1.5 text-center font-mono text-[10px] tabular-nums focus:border-primary focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void saveWeight(r.id, currentWeight)}
                          disabled={savingWeightId === r.id}
                          className="rounded p-0.5 text-zbooni-green hover:bg-zbooni-green/10 disabled:opacity-50"
                        >
                          {savingWeightId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWeights((prev) => { const next = { ...prev }; delete next[r.id]; return next; })}
                          className="rounded p-0.5 text-muted-foreground hover:bg-accent/50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingWeights((prev) => ({ ...prev, [r.id]: r.weight ?? 0 }))}
                        className="rounded bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-orange-400 transition-colors hover:bg-orange-500/25"
                        title="Click to edit weight"
                      >
                        {r.weight ?? 0}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {rules.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground/40 italic">No qualification rules configured</p>
      ) : null}
    </div>
  );
}

export default function IcpDetailPage() {
  const { icpId } = useParams<{ icpId: string }>();
  const { apiClient } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [profile, setProfile] = useState<IcpProfileResponse | null>(null);

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

  // Load countries from pipeline_settings (Controls & Settings) — single source of truth
  const pipelineSettings = useApiQuery(
    useCallback(() => apiClient.listPipelineSettings(), [apiClient]),
  );
  const pipelineCountries: string[] = (() => {
    if (!pipelineSettings.data) return [];
    const setting = pipelineSettings.data.items.find((i: { key: string }) => i.key === 'countryCities');
    if (setting?.value && typeof setting.value === 'object') {
      return Object.keys(setting.value as Record<string, unknown>);
    }
    return [];
  })();

  useEffect(() => {
    if (icp.data) {
      setProfile(icp.data);
    }
  }, [icp.data]);

  const handleUpdate = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      const updated = await apiClient.updateIcp(icpId, payload);
      setProfile(updated);
      void icp.refetch();
      toast.success('ICP saved');
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save ICP');
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (icp.error) {
    return <p className="text-sm text-destructive">{icp.error}</p>;
  }

  if (icp.isLoading || !profile) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
        Loading ICP profile...
      </div>
    );
  }

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
              <EditableField label="" value={profile.name} onSave={(val) => handleUpdate({ name: val })} />
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
                onSave={(val) => handleUpdate({ description: val })}
                multiline
                textClassName="text-sm font-normal text-muted-foreground whitespace-pre-line leading-relaxed"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void handleUpdate({ isActive: !profile.isActive }); }}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              profile.isActive
                ? 'bg-zbooni-green/15 text-zbooni-green hover:bg-zbooni-green/25'
                : 'bg-gray-500/15 text-gray-400 hover:bg-gray-500/25'
            }`}
          >
            {profile.isActive ? 'Active' : 'Inactive'}
          </button>
        </div>

        {/* Hook & Angle from metadata — editable */}
        <div className="mt-4 rounded-xl border border-zbooni-teal/20 bg-zbooni-teal/5 p-4">
          <div className="flex items-start gap-2">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-zbooni-teal" />
            <div className="flex-1">
              <EditableField
                label="Sales Hook"
                value={meta.salesHook ?? meta.hook ?? ''}
                multiline
                onSave={(val) =>
                  handleUpdate({
                    metadataJson: {
                    ...meta,
                    salesHook: val || undefined,
                    hook: val || undefined,
                    },
                  })}
                textClassName="italic text-muted-foreground"
              />
            </div>
          </div>
          <div className="mt-3">
            <EditableTags
              label="Sales Angles"
              tags={meta.angle ?? []}
              onSave={(val) => handleUpdate({ metadataJson: { ...meta, angle: val.length > 0 ? val : undefined } })}
              tagClassName="bg-zbooni-teal/10 text-zbooni-teal"
            />
          </div>
        </div>

        {/* Industry Mapping Editor — full width */}
        <div className="mt-5 text-sm">
          <IndustryMappingEditor
            industries={profile.targetIndustries}
            metadataJson={profile.metadataJson}
            onSaveIndustries={(val) => { void handleUpdate({ targetIndustries: val }); }}
            onSaveMetadata={(meta) => { void handleUpdate({ metadataJson: meta }); }}
            apiClient={apiClient}
          />
        </div>

        {/* Target Countries + Logic */}
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <CountrySelector
            countries={profile.targetCountries}
            onSave={(val) => handleUpdate({ targetCountries: val })}
            pipelineCountries={pipelineCountries}
          />
          <div />
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
            onSave={(val) => handleUpdate({ minCompanySize: val ? parseInt(val, 10) : null })}
          />
          <EditableField
            label="Max Company Size"
            value={profile.maxCompanySize !== null ? String(profile.maxCompanySize) : ''}
            onSave={(val) => handleUpdate({ maxCompanySize: val ? parseInt(val, 10) : null })}
          />
          <EditableTags
            label="Required Tech"
            tags={profile.requiredTechnologies}
            onSave={(val) => handleUpdate({ requiredTechnologies: val })}
            tagClassName="bg-purple-500/10 text-purple-400"
          />
          <EditableTags
            label="Excluded Domains"
            tags={profile.excludedDomains}
            onSave={(val) => handleUpdate({ excludedDomains: val })}
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
      <FeaturePitchEditor
        features={profile.featureList ?? []}
        onSave={(val) => handleUpdate({ featureList: val.length > 0 ? val : null })}
      />

      {/* A6: Per-ICP Messaging Instructions */}
      <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zbooni-green" />
          <h2 className="text-base font-bold tracking-tight">Messaging Instructions</h2>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground/50">
          Per-ICP instructions appended to the AI system prompt when generating messages for leads in this ICP.
        </p>
        <EditableField
          label=""
          value={
            (profile.metadataJson && typeof profile.metadataJson === 'object' && 'messagingInstructions' in profile.metadataJson
              ? String((profile.metadataJson as Record<string, unknown>).messagingInstructions ?? '')
              : '')
          }
          multiline
          onSave={(val) =>
            handleUpdate({
              metadataJson: {
                ...(profile.metadataJson ?? {}),
                messagingInstructions: val || undefined,
              },
            })
          }
          textClassName="text-sm text-muted-foreground whitespace-pre-line leading-relaxed"
        />
      </div>

      {/* Scoring Rules — A4: Editable weights from actual qualification rules */}
      <IcpRulesSection profile={profile} apiClient={apiClient} onRulesChanged={() => void icp.refetch()} />

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

            <p className="mb-2 text-sm text-muted-foreground">
              This will permanently delete this ICP and all its qualification rules,
              scoring data, discovery records, and message history.
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              If this ICP has active leads or running discovery jobs, deletion will be blocked and you will see an error explaining why.
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
