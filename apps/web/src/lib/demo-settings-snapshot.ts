export type DemoSettingsSectionId =
  | 'outreach-schedule'
  | 'review-routing'
  | 'contact-safety'
  | 'discovery-scoring';

export interface DemoSettingsSummaryItem {
  label: string;
  value: string;
  detail: string;
}

export interface DemoFollowUpStep {
  label: string;
  timing: string;
  purpose: string;
}

export interface DemoSettingsItem {
  label: string;
  value: string;
  detail: string;
}

export interface DemoSettingsSection {
  id: DemoSettingsSectionId;
  title: string;
  description: string;
  items: readonly DemoSettingsItem[];
}

export interface DemoSettingsSnapshot {
  summary: readonly DemoSettingsSummaryItem[];
  followUps: readonly DemoFollowUpStep[];
  stopConditions: readonly string[];
  sections: readonly DemoSettingsSection[];
}

export const DEMO_SETTINGS_SNAPSHOT = {
  summary: [
    {
      label: 'Operating timezone',
      value: 'Recipient local time',
      detail: 'Schedule windows follow each contact’s market.',
    },
    {
      label: 'Active days',
      value: 'Monday–Friday',
      detail: 'Weekends and observed holidays are paused.',
    },
    {
      label: 'Follow-up policy',
      value: '3 over 14 days',
      detail: 'The sequence closes automatically after 21 days.',
    },
    {
      label: 'Priority threshold',
      value: '65 / 100',
      detail: 'High-fit leads move into operator review.',
    },
  ],
  followUps: [
    {
      label: 'Follow-up 1',
      timing: 'Day 3',
      purpose: 'Reframe the original value proposition with one new proof point.',
    },
    {
      label: 'Follow-up 2',
      timing: 'Day 7',
      purpose: 'Offer a relevant example and a low-friction next step.',
    },
    {
      label: 'Final follow-up',
      timing: 'Day 14',
      purpose: 'Close the loop politely and leave the conversation open.',
    },
  ],
  stopConditions: [
    'Reply received',
    'Meeting booked',
    'Unsubscribed',
    'Hard bounce',
  ],
  sections: [
    {
      id: 'outreach-schedule',
      title: 'Outreach schedule',
      description: 'Company-wide delivery windows and sender capacity.',
      items: [
        {
          label: 'Send window',
          value: '8:30 AM–4:30 PM',
          detail: 'Calculated in the recipient’s local timezone.',
        },
        {
          label: 'Daily sender cap',
          value: '35 emails',
          detail: 'Per connected sender, including scheduled follow-ups.',
        },
        {
          label: 'Weekend delivery',
          value: 'Paused',
          detail: 'Queued work resumes in the next eligible window.',
        },
        {
          label: 'Holiday calendar',
          value: 'Observed',
          detail: 'Uses the contact’s primary market when available.',
        },
      ],
    },
    {
      id: 'review-routing',
      title: 'Review and routing',
      description: 'Ownership rules for drafts, replies, and handoffs.',
      items: [
        {
          label: 'First-touch review',
          value: 'Required',
          detail: 'An operator reviews the initial personalized draft.',
        },
        {
          label: 'Reply owner',
          value: 'Account owner',
          detail: 'Replies stay with the operator already responsible for the lead.',
        },
        {
          label: 'Interested-reply alert',
          value: 'Immediate',
          detail: 'The assigned operator receives an inbox notification.',
        },
        {
          label: 'Reply SLA reminder',
          value: '4 business hours',
          detail: 'Open replies are resurfaced before the response window expires.',
        },
      ],
    },
    {
      id: 'contact-safety',
      title: 'Contact safety',
      description: 'Guardrails that prevent duplicate or inappropriate outreach.',
      items: [
        {
          label: 'Suppression',
          value: 'Always enforced',
          detail: 'Unsubscribes and hard bounces are excluded automatically.',
        },
        {
          label: 'Active sequences',
          value: '1 per contact',
          detail: 'A contact cannot enter overlapping campaigns.',
        },
        {
          label: 'Duplicate protection',
          value: 'Domain + email',
          detail: 'Normalized company and contact identifiers are checked first.',
        },
        {
          label: 'Company cooling period',
          value: '7 days',
          detail: 'Limits competing outreach to contacts at the same account.',
        },
      ],
    },
    {
      id: 'discovery-scoring',
      title: 'Discovery and scoring',
      description: 'Workspace defaults applied before ICP-specific qualification signals.',
      items: [
        {
          label: 'Priority threshold',
          value: '65 / 100',
          detail: 'Qualified high-fit leads enter the priority review queue.',
        },
        {
          label: 'Enrichment threshold',
          value: '50 / 100',
          detail: 'Lower-scoring records remain searchable without paid enrichment.',
        },
        {
          label: 'Discovery run cap',
          value: '5 search tasks',
          detail: 'Keeps demo discovery jobs bounded and reviewable.',
        },
        {
          label: 'Provider cost guard',
          value: '$50 / day',
          detail: 'Workspace-wide ceiling across enrichment providers.',
        },
      ],
    },
  ],
} as const satisfies DemoSettingsSnapshot;
