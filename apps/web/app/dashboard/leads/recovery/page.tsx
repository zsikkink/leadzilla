'use client';

import type { ContactRecoveryCandidate, ContactRecoveryItem } from '@lead-flood/contracts';
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Mail,
  Phone,
  Search,
  ShieldX,
  UserRound,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AboutBusinessCard } from '@/components/about-business-card.js';
import { CustomSelect } from '@/components/custom-select.js';
import { LeadsNav } from '@/components/leads-nav.js';
import { useApiQuery } from '@/hooks/use-api-query.js';
import { useAuth } from '@/hooks/use-auth.js';
import { cn } from '@/lib/utils.js';
import { countryName } from '@/lib/countries.js';
import { getWebEnv } from '@/lib/env.js';
import { getSupabaseBrowserClient } from '@/lib/supabase-client.js';

// ── Constants ────────────────────────────────────────────────────────────────

const _STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open queue' },
  { value: 'REJECTED', label: 'Rejected items' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function displayOrNA(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : 'N/A';
}

function scorePercent(score: number | null | undefined): string {
  if (score == null) return 'N/A';
  return `${Math.round(score * 100)}%`;
}

function formatSeniority(seniority: string): string {
  return seniority
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatReason(reason: string, candidateCount: number): string {
  if (reason === 'NO_CONTACTS_FOUND' && candidateCount === 0) {
    return 'No contacts found';
  }
  return 'No sendable email';
}

function formatTerminalReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'no_named_candidate_found':
      return 'No named candidate found';
    case 'named_candidate_no_email':
      return 'Named candidate, no email';
    case 'email_inferred_failed_verification':
      return 'Inferred email failed verification';
    case 'ambiguous_winner':
      return 'Ambiguous winner';
    default:
      return 'N/A';
  }
}

function extractMetaDescription(intelligence: unknown): string | null {
  if (!intelligence || typeof intelligence !== 'object') return null;
  const obj = intelligence as Record<string, unknown>;
  if (typeof obj.metaDescription === 'string') return obj.metaDescription;
  return null;
}

function extractInstagramBio(intelligence: unknown): string | null {
  if (!intelligence || typeof intelligence !== 'object') return null;
  const obj = intelligence as Record<string, unknown>;
  if (typeof obj.biography === 'string') return obj.biography;
  if (typeof obj.bio === 'string') return obj.bio;
  return null;
}

function parseBusinessInsights(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'insights' in parsed) {
      return String((parsed as Record<string, unknown>).insights);
    }
    return raw;
  } catch {
    return raw;
  }
}

// ── Score badge (matches business intel page) ────────────────────────────────

function ScoreBadge({ score, band }: { score: number | null | undefined; band: string | null | undefined }) {
  if (score == null || score === 0) {
    return (
      <span className="rounded-md bg-muted/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">
        Not scored
      </span>
    );
  }
  const color = band === 'HIGH'
    ? 'text-zbooni-green bg-zbooni-green/10'
    : band === 'MEDIUM'
      ? 'text-yellow-400 bg-yellow-400/10'
      : 'text-red-400 bg-red-400/10';
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', color)}>
      {score.toFixed(2)} {band ?? ''}
    </span>
  );
}

// ── Candidate card ───────────────────────────────────────────────────────────

function CandidateCard({ candidate }: { candidate: ContactRecoveryCandidate }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/20 bg-slate-800 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-[11px] font-bold text-amber-400">
        {candidate.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{candidate.name}</p>
          <span className="shrink-0 rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground/60">
            {formatSeniority(candidate.seniority)}
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground/50">
          {displayOrNA(candidate.title)}
        </p>
        <p className="text-[9px] text-muted-foreground/30">
          {candidate.source} {candidate.confidence != null ? `(${scorePercent(candidate.confidence)})` : ''}
        </p>
      </div>

      {/* Email status */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {candidate.isSendable && candidate.email ? (
          <a
            href={`mailto:${candidate.email}`}
            title={candidate.email}
            className="flex items-center gap-1 text-[11px] text-zbooni-teal transition-colors hover:text-zbooni-green"
          >
            <Mail className="h-3 w-3" />
            <span className="hidden max-w-[140px] truncate sm:inline">{candidate.email}</span>
          </a>
        ) : (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            No sendable email
          </span>
        )}
        <div className="flex gap-1.5">
          {candidate.linkedinUrl ? (
            <a
              href={candidate.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="LinkedIn"
              className="text-muted-foreground/40 transition-colors hover:text-zbooni-teal"
            >
              <Linkedin className="h-3 w-3" />
            </a>
          ) : null}
          {candidate.phone ? (
            <a
              href={`tel:${candidate.phone}`}
              title={candidate.phone}
              className="text-muted-foreground/40 transition-colors hover:text-zbooni-teal"
            >
              <Phone className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── List card (left sidebar) — matches BusinessCard style ────────────────────

function RecoveryListCard({
  item,
  isSelected,
  onSelect,
}: {
  item: ContactRecoveryItem;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const hasSendable = item.snapshot.topCandidates.some((c) => c.isSendable);
  const location = [
    item.business.countryCode ? countryName(item.business.countryCode) : item.business.country,
    item.business.city,
  ].filter(Boolean).join(' / ');

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition-all duration-200',
        isSelected
          ? 'border-zbooni-teal/40 bg-zbooni-teal/[0.04] shadow-[0_0_20px_rgba(60,200,224,0.06)]'
          : 'border-border/30 bg-zbooni-dark/20 hover:border-border/50 hover:bg-zbooni-dark/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold tracking-tight">{item.business.name}</p>
          <p className="text-[11px] text-muted-foreground/60">
            {displayOrNA(item.business.category)}
          </p>
        </div>
        <ScoreBadge score={item.business.deterministicScore} band={item.business.scoreBand} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground/40">
        <span className="flex items-center gap-1">
          <Globe className="h-3 w-3" />
          {location || 'N/A'}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.business.websiteDomain ? (
          <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">Web</span>
        ) : null}
        {item.business.instagramHandle ? (
          <span className="rounded-full bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-pink-400">IG</span>
        ) : null}
        {item.candidateCount > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
            {item.candidateCount} contact{item.candidateCount === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className={cn(
          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
          hasSendable
            ? 'bg-zbooni-green/15 text-zbooni-green'
            : item.candidateCount > 0
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-red-500/10 text-red-400',
        )}>
          {hasSendable
            ? 'Has email'
            : formatReason(item.reason, item.candidateCount)}
        </span>
      </div>
    </button>
  );
}

// ── Detail panel (right side) — matches BusinessDetailPanel style ────────────

function RecoveryDetailPanel({
  item,
  onReject,
  rejecting,
  onApprove,
  approving,
  enrichment,
}: {
  item: ContactRecoveryItem;
  onReject: () => void;
  rejecting: boolean;
  onApprove: () => void;
  approving: boolean;
  enrichment: RecoveryBusinessEnrichment | null;
}) {
  const metaDescription = extractMetaDescription(item.snapshot.websiteIntelligence);
  const igBio = extractInstagramBio(item.snapshot.instagramIntelligence);
  const insights = parseBusinessInsights(item.snapshot.businessInsights);
  const location = [
    item.business.countryCode ? countryName(item.business.countryCode) : item.business.country,
    item.business.city,
  ].filter(Boolean).join(', ');
  const hasSendable = item.snapshot.topCandidates.some((c) => c.isSendable);

  return (
    <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      {/* Header — matches business intel header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/30 pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-zbooni-teal" />
            <h2 className="truncate text-lg font-extrabold tracking-tight">{item.business.name}</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground/60">
            {displayOrNA(item.business.category)} &middot; {location || 'N/A'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBadge score={item.business.deterministicScore} band={item.business.scoreBand} />
          {item.status === 'OPEN' ? (
            <>
              <button
                type="button"
                onClick={onApprove}
                disabled={approving || rejecting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zbooni-green/40 bg-zbooni-green/10 px-2.5 py-1.5 text-xs font-semibold text-zbooni-green transition-colors hover:bg-zbooni-green/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={rejecting || approving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldX className="h-3.5 w-3.5" />}
                Reject
              </button>
            </>
          ) : null}
          {item.status === 'REJECTED' ? (
            <div className="flex items-center gap-2">
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] text-red-300">
                Rejected {item.rejectedAt ? new Date(item.rejectedAt).toLocaleDateString() : ''}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* About This Business — reuses shared component */}
      <div className="mt-4">
        <AboutBusinessCard
          category={item.business.category}
          metaDescription={metaDescription}
          instagramBio={igBio}
          countryCode={item.business.countryCode}
          city={item.business.city}
          rating={enrichment?.rating ?? null}
          reviewCount={enrichment?.reviewCount ?? null}
        />
      </div>

      {/* Quick stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Contacts Found</p>
          <p className="mt-0.5 text-sm font-bold">{item.candidateCount}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email Status</p>
          <p className={cn('mt-0.5 text-sm font-bold', hasSendable ? 'text-zbooni-green' : 'text-amber-300')}>
            {hasSendable ? 'Available' : item.candidateCount > 0 ? 'No sendable email' : 'None'}
          </p>
        </div>
        {enrichment?.rating != null ? (
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Google Rating</p>
            <p className="mt-0.5 text-sm font-bold">{enrichment.rating}/5</p>
          </div>
        ) : null}
        {enrichment?.reviewCount != null ? (
          <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reviews</p>
            <p className="mt-0.5 text-sm font-bold">{enrichment.reviewCount}</p>
          </div>
        ) : null}
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Terminal Reason</p>
          <p className="mt-0.5 text-xs font-semibold">{formatTerminalReason(item.snapshot.terminalReason)}</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-slate-800 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">ICP</p>
          <p className="mt-0.5 text-xs font-semibold truncate">{displayOrNA(item.icpProfileName)}</p>
        </div>
      </div>

      {/* Contact info links */}
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        {item.business.websiteDomain ? (
          <a
            href={`https://${item.business.websiteDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-zbooni-teal transition-colors hover:border-zbooni-teal/40 hover:text-zbooni-green"
          >
            <Globe className="h-3 w-3" />{item.business.websiteDomain}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground/40">
            <Globe className="h-3 w-3" />N/A
          </span>
        )}
        {item.business.instagramHandle ? (
          <a
            href={`https://instagram.com/${item.business.instagramHandle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-pink-400 transition-colors hover:border-pink-400/40 hover:text-pink-300"
          >
            <Instagram className="h-3 w-3" />@{item.business.instagramHandle}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-muted-foreground/40">
            <Instagram className="h-3 w-3" />N/A
          </span>
        )}
        {item.snapshot.genericBusinessEmail ? (
          <a
            href={`mailto:${item.snapshot.genericBusinessEmail}`}
            className="flex items-center gap-1 rounded-full border border-border/30 px-2.5 py-1 text-blue-400 transition-colors hover:border-blue-400/40 hover:text-blue-300"
          >
            <Mail className="h-3 w-3" />{item.snapshot.genericBusinessEmail}
          </a>
        ) : null}
      </div>

      {/* Business insights */}
      {insights ? (
        <div className="mt-4 rounded-lg border border-border/20 bg-slate-800 px-3 py-2 text-xs text-muted-foreground/70 leading-relaxed">
          {insights}
        </div>
      ) : null}

      {/* Contacts section — the main content for this page */}
      <div className="mt-5 space-y-3">
        <div className="rounded-xl border border-border/30 bg-zbooni-dark/20">
          <div className="flex w-full items-center gap-2 px-4 py-3">
            <UserRound className="h-4 w-4 text-amber-400" />
            <span className="flex-1 text-sm font-bold tracking-tight">Contacts Found</span>
            <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {item.snapshot.topCandidates.length}
            </span>
          </div>
          <div className="border-t border-border/20 px-4 py-3">
            {item.snapshot.topCandidates.length > 0 ? (
              <div className="space-y-2">
                {item.snapshot.topCandidates.map((candidate) => (
                  <CandidateCard
                    key={`${candidate.name}-${candidate.source}-${candidate.seniority}`}
                    candidate={candidate}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <UserRound className="h-8 w-8 text-muted-foreground/20" />
                <p className="mt-2 text-sm text-muted-foreground/50">No contacts found</p>
                <p className="mt-1 text-[11px] text-muted-foreground/30">
                  The pipeline could not identify any decision makers for this business.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Matched signals for candidates that have them */}
        {item.snapshot.topCandidates.some((c) => c.matchedSignals.length > 0) ? (
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Matched Signals</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[...new Set(item.snapshot.topCandidates.flatMap((c) => c.matchedSignals))].map((signal) => (
                <span key={signal} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                  {signal.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Supporting evidence URLs */}
        {item.snapshot.topCandidates.some((c) => c.supportingUrls.length > 0) ? (
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Evidence Links</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...new Set(item.snapshot.topCandidates.flatMap((c) => c.supportingUrls))].slice(0, 5).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-zbooni-teal transition-colors hover:text-zbooni-green"
                >
                  {new URL(url).hostname.replace('www.', '')}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {/* A8: Business Contacts from DB (additional contacts beyond pipeline candidates) */}
        {enrichment && enrichment.contacts.length > 0 ? (
          <div className="rounded-xl border border-border/30 bg-zbooni-dark/20">
            <div className="flex w-full items-center gap-2 px-4 py-3">
              <UserRound className="h-4 w-4 text-blue-400" />
              <span className="flex-1 text-sm font-bold tracking-tight">Additional Business Contacts</span>
              <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                {enrichment.contacts.length}
              </span>
            </div>
            <div className="border-t border-border/20 px-4 py-3">
              <div className="space-y-2">
                {enrichment.contacts.map((contact) => (
                  <div key={contact.id} className="flex items-center gap-3 rounded-lg border border-border/20 bg-slate-800 px-3 py-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-[11px] font-bold text-blue-400">
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">{contact.name}</p>
                        <span className="shrink-0 rounded-full bg-muted/20 px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground/60">
                          {formatSeniority(contact.seniority)}
                        </span>
                      </div>
                      {contact.title ? (
                        <p className="truncate text-[11px] text-muted-foreground/50">{contact.title}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {contact.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          title={contact.email}
                          className="flex items-center gap-1 text-[11px] text-zbooni-teal transition-colors hover:text-zbooni-green"
                        >
                          <Mail className="h-3 w-3" />
                          <span className="hidden max-w-[140px] truncate sm:inline">{contact.email}</span>
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">No email</span>
                      )}
                      {contact.phone ? (
                        <a href={`tel:${contact.phone}`} title={contact.phone} className="text-muted-foreground/40 transition-colors hover:text-zbooni-teal">
                          <Phone className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Scraped timestamps */}
        <div className="flex gap-4 text-[10px] text-muted-foreground/30">
          <span>Run {item.discoveryRunId.slice(0, 8)}</span>
          <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── A8: Enriched business data from Supabase ──────────────────────────────────

interface RecoveryBusinessContact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  seniority: string;
}

interface RecoveryBusinessEnrichment {
  rating: number | null;
  reviewCount: number | null;
  contacts: RecoveryBusinessContact[];
}

async function fetchRecoveryBusinessEnrichment(businessId: string): Promise<RecoveryBusinessEnrichment> {
  const empty: RecoveryBusinessEnrichment = { rating: null, reviewCount: null, contacts: [] };
  try {
    const supabase = getSupabaseBrowserClient();
    const [bizResult, contactsResult] = await Promise.allSettled([
      supabase.from('businesses').select('rating, review_count').eq('id', businessId).single(),
      supabase.from('business_contacts').select('id, name, title, email, phone, seniority').eq('businessId', businessId).order('positionRank', { ascending: true }),
    ]);

    const biz = bizResult.status === 'fulfilled' ? bizResult.value.data : null;
    const contacts = contactsResult.status === 'fulfilled' ? (contactsResult.value.data ?? []) : [];

    return {
      rating: typeof biz?.rating === 'number' ? biz.rating : null,
      reviewCount: typeof biz?.review_count === 'number' ? biz.review_count : null,
      contacts: contacts.map((c: Record<string, unknown>) => ({
        id: String(c.id ?? ''),
        name: String(c.name ?? 'Unknown'),
        title: typeof c.title === 'string' ? c.title : null,
        email: typeof c.email === 'string' ? c.email : null,
        phone: typeof c.phone === 'string' ? c.phone : null,
        seniority: typeof c.seniority === 'string' ? c.seniority : 'other',
      })),
    };
  } catch {
    return empty;
  }
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function ContactRecoveryPage() {
  const { apiClient, token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('selected'));
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [businessEnrichment, setBusinessEnrichment] = useState<RecoveryBusinessEnrichment | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const recovery = useApiQuery(
    useCallback(
      () =>
        apiClient.listContactRecoveryItems({
          page,
          pageSize,
          status: 'OPEN',
          ...(debouncedQuery ? { q: debouncedQuery } : {}),
        }),
      [apiClient, debouncedQuery, page, pageSize],
    ),
    [debouncedQuery, page, pageSize],
  );

  useEffect(() => {
    const requestedSelected = searchParams.get('selected');
    if (requestedSelected) {
      setSelectedId(requestedSelected);
    }
  }, [searchParams]);

  useEffect(() => {
    const firstId = recovery.data?.items[0]?.id ?? null;
    if (!selectedId && firstId) {
      setSelectedId(firstId);
    }
    if (selectedId && recovery.data && !recovery.data.items.some((item) => item.id === selectedId)) {
      setSelectedId(firstId);
    }
  }, [recovery.data, selectedId]);

  const selected = selectedId
    ? recovery.data?.items.find((item) => item.id === selectedId) ?? null
    : null;

  // A8: Fetch enriched business data (rating, review count, contacts) for selected item
  useEffect(() => {
    if (!selected) {
      setBusinessEnrichment(null);
      return;
    }
    let cancelled = false;
    void fetchRecoveryBusinessEnrichment(selected.businessId).then((data) => {
      if (!cancelled) setBusinessEnrichment(data);
    });
    return () => { cancelled = true; };
  }, [selected?.businessId, selected]);

  const totalPages = recovery.data ? Math.max(1, Math.ceil(recovery.data.total / recovery.data.pageSize)) : 1;

  async function handleReject(item: ContactRecoveryItem): Promise<void> {
    if (!window.confirm(`Reject "${item.business.name}" from the contact recovery queue?`)) {
      return;
    }

    setRejectingId(item.id);
    try {
      await apiClient.rejectContactRecoveryItem(item.id);
      toast.success(`${item.business.name} removed from the open recovery queue`);
      recovery.refetch();
      router.replace('/dashboard/leads/recovery');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to reject contact recovery item');
    } finally {
      setRejectingId(null);
    }
  }

  async function handleApprove(item: ContactRecoveryItem): Promise<void> {
    if (!window.confirm(`Create a lead from "${item.business.name}" using the best available contact?`)) {
      return;
    }

    setApprovingId(item.id);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(
        `${getWebEnv().NEXT_PUBLIC_API_BASE_URL}/v1/discovery-admin/recovery/${item.id}/approve`,
        { method: 'POST', headers },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Approve failed (${res.status})`);
      }

      const result = await res.json() as { leadId: string; businessName: string };
      toast.success(`Lead created from ${result.businessName}`);
      recovery.refetch();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to approve recovery item');
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <LeadsNav active="contact-recovery" />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Contact Recovery</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {recovery.data ? `${recovery.data.total} items` : 'Loading...'} &middot; Good-fit businesses needing a decision-maker contact
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3 lg:flex-1">
            <Search className="h-4 w-4 text-muted-foreground/40" />
            <input
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Filter by name, category, city, domain, or Instagram handle..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
            <span className="text-[11px] text-muted-foreground/40">{recovery.data?.items.length ?? 0} shown</span>
          </div>
          <CustomSelect
            value={String(pageSize)}
            onChange={(value) => {
              setPageSize(parseInt(value, 10) || 20);
              setPage(1);
            }}
            options={[
              { value: '10', label: '10 per page' },
              { value: '20', label: '20 per page' },
              { value: '40', label: '40 per page' },
            ]}
            placeholder="20 per page"
          />
        </div>
      </div>

      {recovery.error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {recovery.error}
        </div>
      ) : null}

      {/* Main layout — matches business intel grid */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Left: recovery item list */}
        <div className="space-y-3 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
          {recovery.isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border/30 bg-zbooni-dark/20 p-6">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground/50">Loading recovery queue...</span>
            </div>
          ) : recovery.data && recovery.data.items.length > 0 ? (
            <>
              {recovery.data.items.map((item) => (
                <RecoveryListCard
                  key={item.id}
                  item={item}
                  isSelected={item.id === selectedId}
                  onSelect={() => {
                    setSelectedId(item.id);
                    router.replace(`/dashboard/leads/recovery?selected=${item.id}`);
                  }}
                />
              ))}
              {/* Pagination */}
              {totalPages > 1 ? (
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-muted-foreground/40">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page >= totalPages}
                    className="rounded-lg border border-border/30 px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-border/30 bg-zbooni-dark/20 p-6 text-center">
              <Building2 className="mx-auto h-8 w-8 text-muted-foreground/20" />
              <p className="mt-2 text-sm text-muted-foreground/50">No recovery items found</p>
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selected ? (
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
            <RecoveryDetailPanel
              item={selected}
              rejecting={rejectingId === selected.id}
              onReject={() => void handleReject(selected)}
              approving={approvingId === selected.id}
              onApprove={() => void handleApprove(selected)}
              enrichment={businessEnrichment}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="flex flex-col items-center justify-center py-20">
              <Building2 className="h-12 w-12 text-muted-foreground/15" />
              <h3 className="mt-4 text-base font-bold tracking-tight text-muted-foreground/60">Select a recovery item</h3>
              <p className="mt-1 max-w-xs text-center text-[12px] text-muted-foreground/35">
                Click a business to view contact details, email status, and candidate decision makers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
