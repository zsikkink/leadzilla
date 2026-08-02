export type DemoOperatingMonth = {
  month: string;
  label: string;
  milestone: string;
  sourceRecords: number;
  duplicatesMerged: number;
  screened: number;
  disqualified: number;
  scored: number;
  priority: number;
  drafts: number;
  sent: number;
  replies: number;
  meetings: number;
};

export type DemoLead = {
  id: string;
  contactName: string;
  role: string;
  company: string;
  email: string;
  location: string;
  segment: string;
  score: number;
  status: 'High fit' | 'Priority';
  channels: string;
};

export type DemoInboxMessageEvent = {
  id: string;
  kind: 'message';
  direction: 'inbound' | 'outbound';
  timestamp: string;
  channel: 'EMAIL' | 'WHATSAPP';
  subject?: string | undefined;
  body: string;
  followUpNumber?: number | undefined;
  classification?: 'INTERESTED' | 'NOT_INTERESTED' | 'NOT_NOW' | 'OUT_OF_OFFICE' | undefined;
};

export type DemoInboxMeetingEvent = {
  id: string;
  kind: 'meeting';
  timestamp: string;
  title: string;
  scheduledFor: string;
  durationMinutes: number;
  status: 'Confirmed' | 'Tentative';
  location: string;
  agenda: string;
};

export type DemoInboxNoteEvent = {
  id: string;
  kind: 'note';
  timestamp: string;
  label: string;
  body: string;
};

export type DemoInboxTimelineEvent =
  | DemoInboxMessageEvent
  | DemoInboxMeetingEvent
  | DemoInboxNoteEvent;

export type DemoInboxDraft = {
  id: string;
  leadId: string;
  createdAt: string;
  channel: 'EMAIL' | 'WHATSAPP';
  subject?: string | undefined;
  body: string;
  status: 'Pending review' | 'Needs context' | 'Review on nurture date';
  followUpNumber: number;
  operatorNote: string;
};

export type DemoInboxConversation = {
  id: string;
  leadId: string;
  stage: 'Meeting booked' | 'Interested' | 'Nurture' | 'Draft review' | 'Closed';
  unreadCount: number;
  lastActivityAt: string;
  preview: string;
  events: DemoInboxTimelineEvent[];
};

export const DEMO_NARRATIVE_VERSION = '2026.08.two-month-db-anchored.v3';
export const DEMO_REPORTING_PERIOD = 'June – July 2026';
export const DEMO_SNAPSHOT_GENERATED_AT = '2026-08-01T14:00:00.000Z';

// Captured from the production demo database on 2026-08-01. Active leads exclude
// soft-deleted rows; score bands use the latest prediction per lead.
export const DEMO_DATABASE_SNAPSHOT = {
  databaseLeads: 4907,
  rejectedLeads: 479,
  scoredLeads: 4428,
  highPriorityLeads: 2528,
  mediumFitLeads: 1845,
  lowFitLeads: 55,
  messageDrafts: 189,
  averageScore: 0.667,
} as const;

export const DEMO_OPERATING_MONTHS: readonly DemoOperatingMonth[] = [
  {
    month: '2026-06',
    label: 'Jun',
    milestone: 'Established the scored lead inventory and the first operator-reviewed outreach cohort.',
    sourceRecords: 2214,
    duplicatesMerged: 0,
    screened: 2214,
    disqualified: 215,
    scored: 1999,
    priority: 1150,
    drafts: 82,
    sent: 70,
    replies: 9,
    meetings: 2,
  },
  {
    month: '2026-07',
    label: 'Jul',
    milestone: 'Expanded the strongest ICPs and introduced reply-driven follow-up review.',
    sourceRecords: 2693,
    duplicatesMerged: 0,
    screened: 2693,
    disqualified: 264,
    scored: 2429,
    priority: 1378,
    drafts: 107,
    sent: 95,
    replies: 14,
    meetings: 4,
  },
] as const;

function sumMonths(key: keyof Pick<
  DemoOperatingMonth,
  | 'sourceRecords'
  | 'duplicatesMerged'
  | 'screened'
  | 'disqualified'
  | 'scored'
  | 'priority'
  | 'drafts'
  | 'sent'
  | 'replies'
  | 'meetings'
>): number {
  return DEMO_OPERATING_MONTHS.reduce((total, month) => total + month[key], 0);
}

export const DEMO_OPERATING_TOTALS = {
  sourceRecords: sumMonths('sourceRecords'),
  duplicatesMerged: sumMonths('duplicatesMerged'),
  screened: sumMonths('screened'),
  disqualified: sumMonths('disqualified'),
  scored: sumMonths('scored'),
  priority: sumMonths('priority'),
  drafts: sumMonths('drafts'),
  sent: sumMonths('sent'),
  replies: sumMonths('replies'),
  meetings: sumMonths('meetings'),
  pendingReview: 12,
  overdueReview: 3,
  highFit: DEMO_DATABASE_SNAPSHOT.highPriorityLeads,
  mediumFit: DEMO_DATABASE_SNAPSHOT.mediumFitLeads,
  lowFit: DEMO_DATABASE_SNAPSHOT.lowFitLeads,
  averageScore: DEMO_DATABASE_SNAPSHOT.averageScore,
} as const;

let cumulativeSent = 0;
let cumulativeReplies = 0;
export const DEMO_DASHBOARD_TREND_BUCKETS = DEMO_OPERATING_MONTHS.map((month) => {
  cumulativeSent += month.sent;
  cumulativeReplies += month.replies;
  return {
    date: `${month.month}-01`,
    Activated: month.screened,
    Qualified: month.priority,
    Rejected: month.disqualified,
    Sent: cumulativeSent,
    Replied: cumulativeReplies,
  };
});

const FEATURED_DEMO_LEADS: readonly DemoLead[] = [
  {
    id: 'demo-aster-stone',
    contactName: 'Maya Bennett',
    role: 'Director of Client Experience',
    company: 'Aster & Stone Design',
    email: 'maya@aster-stone.example',
    location: 'Austin, US',
    segment: 'Home & Design',
    score: 92,
    status: 'High fit',
    channels: 'Email · Instagram',
  },
  {
    id: 'demo-northline-wellness',
    contactName: 'Noah Patel',
    role: 'Growth Operations Manager',
    company: 'Northline Wellness',
    email: 'noah@northline-wellness.example',
    location: 'Chicago, US',
    segment: 'Premium Wellness',
    score: 89,
    status: 'High fit',
    channels: 'Email · Booking',
  },
  {
    id: 'demo-maison-rue',
    contactName: 'Camille Mercer',
    role: 'Managing Partner',
    company: 'Maison Rue Events',
    email: 'camille@maison-rue.example',
    location: 'New York, US',
    segment: 'Events & Experiences',
    score: 86,
    status: 'High fit',
    channels: 'Email · WhatsApp',
  },
  {
    id: 'demo-foundry-house',
    contactName: 'Eli Brooks',
    role: 'Commercial Director',
    company: 'Foundry House Co.',
    email: 'eli@foundry-house.example',
    location: 'Denver, US',
    segment: 'High-Value Contracting',
    score: 82,
    status: 'Priority',
    channels: 'Email · Phone',
  },
  {
    id: 'demo-luma-gifting',
    contactName: 'Sofia Vega',
    role: 'Founder',
    company: 'Luma Gifting Studio',
    email: 'sofia@luma-gifting.example',
    location: 'Miami, US',
    segment: 'Bespoke Gifting',
    score: 78,
    status: 'Priority',
    channels: 'Email · Instagram',
  },
] as const;

const SUPPORTING_FIRST_NAMES = [
  'Avery', 'Nina', 'Marcus', 'Priya', 'Theo', 'Elena', 'Jonah', 'Leila', 'Owen', 'Amara',
  'Miles', 'Tessa', 'Ravi', 'Clara', 'Julian', 'Mina', 'Grant', 'Nadia', 'Lucas', 'Iris',
] as const;
const SUPPORTING_LAST_NAMES = [
  'Morgan', 'Shah', 'Ellis', 'Kim', 'Reed', 'Navarro', 'Chen', 'Foster', 'Hughes', 'Ali',
  'Bennett', 'Diaz', 'Walker', 'Singh', 'Parker', 'Khan', 'Collins', 'Rivera', 'Brooks', 'Hart',
] as const;
const SUPPORTING_COMPANY_STEMS = [
  'Cedar & Cove', 'Meridian', 'Oakline', 'Hearthstone', 'Juniper', 'Atlas', 'Solace', 'Rivermark',
  'Brightwell', 'Kindred', 'Pollen', 'Ember', 'Northstar', 'Fieldhouse', 'Marlowe', 'Copperleaf',
  'Willow & Finch', 'Halcyon', 'Summit & Sage', 'Bloomcraft',
] as const;
const SUPPORTING_COMPANY_SUFFIXES = [
  'Design Studio', 'Wellness Group', 'Events Co.', 'Hospitality',
  'Home Collective', 'Advisory', 'Experiences', 'Gifting',
] as const;
const SUPPORTING_ROLES = [
  'Operations Director', 'Growth Manager', 'Managing Partner', 'Client Experience Lead',
  'Commercial Director', 'Founder', 'Head of Partnerships', 'Revenue Operations Manager',
] as const;
const SUPPORTING_LOCATIONS = [
  'Austin, US', 'Chicago, US', 'New York, US', 'Denver, US',
  'Miami, US', 'Atlanta, US', 'Seattle, US', 'Boston, US',
] as const;
const SUPPORTING_SEGMENTS = [
  'Home & Design', 'Premium Wellness', 'Events & Experiences', 'Boutique Hospitality',
  'Professional Services', 'High-Value Contracting', 'Experiential Retail', 'Bespoke Gifting',
] as const;

const SUPPORTING_DEMO_LEADS: readonly DemoLead[] = Array.from({ length: 158 }, (_, index) => {
  const firstName = SUPPORTING_FIRST_NAMES[index % SUPPORTING_FIRST_NAMES.length] ?? 'Taylor';
  const lastName = SUPPORTING_LAST_NAMES[(index * 7) % SUPPORTING_LAST_NAMES.length] ?? 'Morgan';
  const companyStem = SUPPORTING_COMPANY_STEMS[index % SUPPORTING_COMPANY_STEMS.length] ?? 'Meridian';
  const companySuffix = SUPPORTING_COMPANY_SUFFIXES[Math.floor(index / SUPPORTING_COMPANY_STEMS.length)] ?? 'Studio';
  const company = `${companyStem} ${companySuffix}`;
  const emailSlug = company.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const score = 74 + ((index * 7) % 19);
  return {
    id: `demo-support-${String(index + 1).padStart(3, '0')}`,
    contactName: `${firstName} ${lastName}`,
    role: SUPPORTING_ROLES[index % SUPPORTING_ROLES.length] ?? 'Operations Director',
    company,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index + 1}@${emailSlug}.example`,
    location: SUPPORTING_LOCATIONS[index % SUPPORTING_LOCATIONS.length] ?? 'Chicago, US',
    segment: SUPPORTING_SEGMENTS[index % SUPPORTING_SEGMENTS.length] ?? 'Professional Services',
    score,
    status: score >= 85 ? 'High fit' : 'Priority',
    channels: 'Email · Website',
  } satisfies DemoLead;
});

export const DEMO_LEADS: readonly DemoLead[] = [
  ...FEATURED_DEMO_LEADS,
];

export const DEMO_INBOX_LEADS: readonly DemoLead[] = [
  ...FEATURED_DEMO_LEADS,
  ...SUPPORTING_DEMO_LEADS,
];

const FEATURED_DEMO_INBOX_CONVERSATIONS: readonly DemoInboxConversation[] = [
  {
    id: 'conversation-aster-stone',
    leadId: 'demo-aster-stone',
    stage: 'Meeting booked',
    unreadCount: 0,
    lastActivityAt: '2026-07-28T15:12:00.000Z',
    preview: 'Meeting confirmed for August 4 · inquiry routing and consultation handoff.',
    events: [
      {
        id: 'aster-initial',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-21T15:05:00.000Z',
        channel: 'EMAIL',
        subject: 'A faster path from project inquiry to booked consultation',
        body: 'Hi Maya,\n\nI noticed Aster & Stone handles both design inquiries and consultation booking across several customer channels. Teams at that stage often lose useful project context between the first Instagram or website message and the person running the consultation.\n\nWould it be useful to compare how you route those inquiries today and where the handoff tends to slow down?\n\nBest,\nJordan',
        followUpNumber: 0,
      },
      {
        id: 'aster-reply',
        kind: 'message',
        direction: 'inbound',
        timestamp: '2026-07-22T16:18:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: A faster path from project inquiry to booked consultation',
        body: 'Hi Jordan,\n\nWe are actively trying to improve this. Instagram and email inquiries often reach different people, and the consultation notes do not always follow the client. I would be interested in seeing how you would structure that handoff.\n\nMaya',
        classification: 'INTERESTED',
      },
      {
        id: 'aster-follow-up',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-22T18:42:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: A faster path from project inquiry to booked consultation',
        body: 'Thanks, Maya. That is exactly the workflow I had in mind. I can show you a compact routing model that keeps source, project type, budget range, and consultation ownership together without asking the client to repeat themselves.\n\nWould Tuesday morning work for a 30-minute walkthrough?',
        followUpNumber: 1,
      },
      {
        id: 'aster-meeting',
        kind: 'meeting',
        timestamp: '2026-07-28T15:12:00.000Z',
        title: 'Aster & Stone workflow review',
        scheduledFor: '2026-08-04T15:00:00.000Z',
        durationMinutes: 30,
        status: 'Confirmed',
        location: 'Video call',
        agenda: 'Inquiry routing, consultation ownership, and project-context handoff.',
      },
    ],
  },
  {
    id: 'conversation-northline-wellness',
    leadId: 'demo-northline-wellness',
    stage: 'Meeting booked',
    unreadCount: 1,
    lastActivityAt: '2026-07-27T18:35:00.000Z',
    preview: 'Noah added clinic operations to the walkthrough scheduled for August 5.',
    events: [
      {
        id: 'northline-initial',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-17T14:20:00.000Z',
        channel: 'EMAIL',
        subject: 'Reducing the drop-off between interest and appointments',
        body: 'Hi Noah,\n\nNorthline makes the consultation path clear, but appointment-led teams often still lose momentum between a first question, a suitable time, and the deposit step. Leadzilla brings those signals into one review queue so the operator knows which conversations need attention next.\n\nIs that handoff something your growth team is working on this quarter?\n\nBest,\nJordan',
        followUpNumber: 0,
      },
      {
        id: 'northline-follow-up',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-21T14:32:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: Reducing the drop-off between interest and appointments',
        body: 'Hi Noah,\n\nOne useful starting point is measuring how many consultation requests receive an owner, a next step, and a response inside the same business day. If that is already visible in your booking stack, I am happy to close the loop.\n\nJordan',
        followUpNumber: 1,
      },
      {
        id: 'northline-reply',
        kind: 'message',
        direction: 'inbound',
        timestamp: '2026-07-22T16:06:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: Reducing the drop-off between interest and appointments',
        body: 'The biggest gap is between a consultation request and the deposit step. Please include our clinic operations lead if we set up a walkthrough. Thursday afternoon is usually best.',
        classification: 'INTERESTED',
      },
      {
        id: 'northline-meeting',
        kind: 'meeting',
        timestamp: '2026-07-27T18:35:00.000Z',
        title: 'Northline consultation-funnel walkthrough',
        scheduledFor: '2026-08-05T18:30:00.000Z',
        durationMinutes: 25,
        status: 'Confirmed',
        location: 'Video call',
        agenda: 'Consultation deposits, booking handoff, and operator visibility.',
      },
    ],
  },
  {
    id: 'conversation-maison-rue',
    leadId: 'demo-maison-rue',
    stage: 'Draft review',
    unreadCount: 1,
    lastActivityAt: '2026-07-29T17:44:00.000Z',
    preview: 'Asked how venue, budget, and date context would reach the assigned coordinator.',
    events: [
      {
        id: 'maison-initial',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-23T16:10:00.000Z',
        channel: 'WHATSAPP',
        body: 'Hi Camille — I was looking at Maison Rue’s event inquiry flow. Leadzilla helps event teams keep venue, date, budget, and response ownership together before a coordinator follows up. Is reducing the back-and-forth on qualified inquiries a priority before the fall season?',
        followUpNumber: 0,
      },
      {
        id: 'maison-reply',
        kind: 'message',
        direction: 'inbound',
        timestamp: '2026-07-23T17:02:00.000Z',
        channel: 'WHATSAPP',
        body: 'Potentially. Our issue is not inquiry volume; it is getting venue, guest count, and target date to the right producer quickly. What would the team need to change?',
        classification: 'INTERESTED',
      },
      {
        id: 'maison-note',
        kind: 'note',
        timestamp: '2026-07-29T17:44:00.000Z',
        label: 'Operator note',
        body: 'Confirm fall-event capacity before approving the response draft.',
      },
    ],
  },
  {
    id: 'conversation-foundry-house',
    leadId: 'demo-foundry-house',
    stage: 'Interested',
    unreadCount: 0,
    lastActivityAt: '2026-07-25T16:20:00.000Z',
    preview: 'Requested a comparable estimate-to-project example before scheduling.',
    events: [
      {
        id: 'foundry-initial',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-15T15:50:00.000Z',
        channel: 'EMAIL',
        subject: 'A cleaner handoff from estimate request to signed project',
        body: 'Hi Eli,\n\nFoundry House’s portfolio suggests a high-consideration sales process: scope, site context, estimate, and several stakeholders before a project is signed. Leadzilla ranks those inquiries and keeps the next action visible so strong projects do not disappear between the website and estimating team.\n\nWould a short example from a similar workflow be relevant?\n\nBest,\nJordan',
        followUpNumber: 0,
      },
      {
        id: 'foundry-reply',
        kind: 'message',
        direction: 'inbound',
        timestamp: '2026-07-17T17:11:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: A cleaner handoff from estimate request to signed project',
        body: 'A comparable example would help. We already use estimating software, so I would mainly want to understand where this sits before a project is created there.',
        classification: 'INTERESTED',
      },
      {
        id: 'foundry-note',
        kind: 'note',
        timestamp: '2026-07-25T16:20:00.000Z',
        label: 'Research needed',
        body: 'Identify the current estimating and CRM tooling before personalizing the reply.',
      },
    ],
  },
  {
    id: 'conversation-luma-gifting',
    leadId: 'demo-luma-gifting',
    stage: 'Nurture',
    unreadCount: 0,
    lastActivityAt: '2026-07-30T14:00:00.000Z',
    preview: 'Revisit in September before year-end corporate-order planning begins.',
    events: [
      {
        id: 'luma-initial',
        kind: 'message',
        direction: 'outbound',
        timestamp: '2026-07-08T13:40:00.000Z',
        channel: 'EMAIL',
        subject: 'Planning ahead for seasonal corporate orders',
        body: 'Hi Sofia,\n\nLuma’s custom gifting work appears to combine high-value orders, personalization, and firm delivery dates. Leadzilla helps teams qualify those requests early and keep artwork, quantity, budget, and decision timing attached to the conversation.\n\nWould it be useful to compare that workflow before year-end planning starts?\n\nBest,\nJordan',
        followUpNumber: 0,
      },
      {
        id: 'luma-reply',
        kind: 'message',
        direction: 'inbound',
        timestamp: '2026-07-10T15:26:00.000Z',
        channel: 'EMAIL',
        subject: 'Re: Planning ahead for seasonal corporate orders',
        body: 'Our corporate calendar is already committed for this cycle. September would be a better time to revisit process changes before year-end planning starts.',
        classification: 'NOT_NOW',
      },
      {
        id: 'luma-nurture',
        kind: 'note',
        timestamp: '2026-07-30T14:00:00.000Z',
        label: 'Nurture review · September 8',
        body: 'Return this draft to the operator queue on September 8. No outbound message is scheduled.',
      },
    ],
  },
] as const;

const JUNE_BUSINESS_DAYS = [
  1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26, 29, 30,
] as const;
const JULY_BUSINESS_DAYS = [
  1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 20, 21, 22, 23, 24, 27, 28, 29, 30, 31,
] as const;
const OUTBOUND_SUBJECTS = [
  'A simpler handoff from new inquiry to next step',
  'Keeping high-intent inquiries from going quiet',
  'A quick question about your consultation workflow',
  'Reducing follow-up gaps as inquiry volume grows',
  'Where qualified inquiries lose momentum',
  'Making lead ownership visible across the team',
  'A cleaner review queue for new opportunities',
  'Connecting inquiry context to the right operator',
] as const;
const REPLY_TEMPLATES: readonly {
  body: string;
  classification: NonNullable<DemoInboxMessageEvent['classification']>;
}[] = [
  { body: 'This is timely. We are reviewing the handoff now and I would be open to seeing a concise example.', classification: 'INTERESTED' },
  { body: 'Can you send a short overview first? If the workflow is relevant, I can bring our operations lead into a call.', classification: 'INTERESTED' },
  { body: 'The ownership piece is relevant for us. Different channels still reach different people, so I would like to compare approaches.', classification: 'INTERESTED' },
  { body: 'We already have a CRM, but the qualification step before a record is created is still inconsistent. How would this fit?', classification: 'INTERESTED' },
  { body: 'Not a priority this month, but please circle back in September when we review the next planning cycle.', classification: 'NOT_NOW' },
  { body: 'Happy to compare notes. Tuesday or Wednesday afternoon is usually easiest for our team.', classification: 'INTERESTED' },
  { body: 'Please include our client services manager if we schedule something. She owns the current routing process.', classification: 'INTERESTED' },
  { body: 'We would need to understand implementation effort and what the operator sees day to day before considering a change.', classification: 'INTERESTED' },
  { body: 'Thanks for reaching out. We are not looking to change this workflow right now, but I appreciate the context.', classification: 'NOT_INTERESTED' },
] as const;

function supportingSendTimestamp(month: 5 | 6, index: number, total: number): string {
  const businessDays = month === 5 ? JUNE_BUSINESS_DAYS : JULY_BUSINESS_DAYS;
  const dayIndex = Math.min(businessDays.length - 1, Math.floor((index * businessDays.length) / total));
  const day = businessDays[dayIndex] ?? 1;
  const hour = 13 + (index % 9);
  const minute = [4, 11, 18, 26, 34, 41, 49, 56][Math.floor(index / 9) % 8] ?? 8;
  return new Date(Date.UTC(2026, month, day, hour, minute)).toISOString();
}

function nextBusinessReplyTimestamp(sentAt: string, replyIndex: number): string {
  const delaysInHours = [2, 5, 19, 27, 44, 52, 73, 92, 117] as const;
  const reply = new Date(new Date(sentAt).getTime() + (delaysInHours[replyIndex % delaysInHours.length] ?? 24) * 3_600_000);

  while (reply.getUTCDay() === 0 || reply.getUTCDay() === 6) {
    reply.setUTCDate(reply.getUTCDate() + 1);
    reply.setUTCHours(14, 15 + ((replyIndex * 7) % 35), 0, 0);
  }
  if (reply.getUTCHours() < 13) {
    reply.setUTCHours(13 + (replyIndex % 4), 12 + ((replyIndex * 5) % 35), 0, 0);
  } else if (reply.getUTCHours() > 21) {
    reply.setUTCDate(reply.getUTCDate() + 1);
    reply.setUTCHours(14 + (replyIndex % 5), 10 + ((replyIndex * 6) % 40), 0, 0);
    while (reply.getUTCDay() === 0 || reply.getUTCDay() === 6) {
      reply.setUTCDate(reply.getUTCDate() + 1);
    }
  }
  return reply.toISOString();
}

function supportingConversation(
  lead: DemoLead,
  index: number,
  month: 5 | 6,
  monthIndex: number,
  monthTotal: number,
  replyIndex: number | null,
): DemoInboxConversation {
  const sentAt = supportingSendTimestamp(month, monthIndex, monthTotal);
  const subject = OUTBOUND_SUBJECTS[index % OUTBOUND_SUBJECTS.length] ?? OUTBOUND_SUBJECTS[0];
  const outbound: DemoInboxMessageEvent = {
    id: `support-${String(index + 1).padStart(3, '0')}-outbound`,
    kind: 'message',
    direction: 'outbound',
    timestamp: sentAt,
    channel: 'EMAIL',
    subject,
    body: `Hi ${lead.contactName.split(' ')[0]},\n\nI was looking at ${lead.company} and noticed how much context your team has to capture before a new inquiry is ready for a real conversation. Leadzilla gives operators one place to qualify fit, assign ownership, and keep the next step visible.\n\nIs tightening that handoff a priority this quarter?\n\nBest,\nJordan`,
    followUpNumber: 0,
  };

  if (replyIndex === null) {
    return {
      id: `conversation-support-${String(index + 1).padStart(3, '0')}`,
      leadId: lead.id,
      stage: 'Closed',
      unreadCount: 0,
      lastActivityAt: sentAt,
      preview: 'Initial outreach sent; no reply recorded during the reporting period.',
      events: [outbound],
    };
  }

  const replyTemplate = REPLY_TEMPLATES[replyIndex % REPLY_TEMPLATES.length] ?? {
    body: 'Thanks for reaching out. A short workflow example would be useful.',
    classification: 'INTERESTED' as const,
  };
  const replyAt = nextBusinessReplyTimestamp(sentAt, replyIndex);
  const reply: DemoInboxMessageEvent = {
    id: `support-${String(index + 1).padStart(3, '0')}-reply`,
    kind: 'message',
    direction: 'inbound',
    timestamp: replyAt,
    channel: 'EMAIL',
    subject: `Re: ${subject}`,
    body: replyTemplate.body,
    classification: replyTemplate.classification,
  };
  const events: DemoInboxTimelineEvent[] = [outbound, reply];
  let stage: DemoInboxConversation['stage'] = replyTemplate.classification === 'NOT_NOW'
    ? 'Nurture'
    : replyTemplate.classification === 'NOT_INTERESTED'
      ? 'Closed'
      : 'Interested';
  let lastActivityAt = replyAt;
  let preview = replyTemplate.body;

  if (replyIndex < 2) {
    const meetingRecordedAt = new Date(new Date(replyAt).getTime() + (3 + replyIndex) * 3_600_000);
    const scheduledFor = new Date(meetingRecordedAt.getTime() + (3 + replyIndex) * 86_400_000);
    events.push({
      id: `support-${String(index + 1).padStart(3, '0')}-meeting`,
      kind: 'meeting',
      timestamp: meetingRecordedAt.toISOString(),
      title: `${lead.company} workflow review`,
      scheduledFor: scheduledFor.toISOString(),
      durationMinutes: replyIndex === 0 ? 30 : 25,
      status: 'Confirmed',
      location: 'Video call',
      agenda: 'Lead qualification, response ownership, and next-step visibility.',
    });
    stage = 'Meeting booked';
    lastActivityAt = meetingRecordedAt.toISOString();
    preview = `Meeting confirmed with ${lead.contactName} after their reply.`;
  }

  return {
    id: `conversation-support-${String(index + 1).padStart(3, '0')}`,
    leadId: lead.id,
    stage,
    unreadCount: replyIndex % 3 === 0 ? 1 : 0,
    lastActivityAt,
    preview,
    events,
  };
}

const SUPPORTING_DEMO_INBOX_CONVERSATIONS: readonly DemoInboxConversation[] = SUPPORTING_DEMO_LEADS.map((lead, index) => {
  const isJune = index < 70;
  const monthIndex = isJune ? index : index - 70;
  const replyPositions = isJune
    ? [4, 11, 18, 25, 32, 39, 45, 50, 55]
    : [5, 13, 21, 29, 37, 45, 51, 56, 60];
  const position = replyPositions.indexOf(monthIndex);
  const replyIndex = position >= 0 ? position : null;
  return supportingConversation(lead, index, isJune ? 5 : 6, monthIndex, isJune ? 70 : 88, replyIndex);
});

export const DEMO_INBOX_CONVERSATIONS: readonly DemoInboxConversation[] = [
  ...FEATURED_DEMO_INBOX_CONVERSATIONS,
  ...SUPPORTING_DEMO_INBOX_CONVERSATIONS,
];

export const DEMO_INBOX_DRAFTS: readonly DemoInboxDraft[] = [
  {
    id: 'draft-maison-rue-follow-up',
    leadId: 'demo-maison-rue',
    createdAt: '2026-07-29T17:48:00.000Z',
    channel: 'WHATSAPP',
    body: 'The team would not need to replace its current event tools. The first step is a shared qualification record that captures venue, date, guest count, budget range, and owner before the producer responds. If fall capacity is still open, I can map that flow in 20 minutes.',
    status: 'Pending review',
    followUpNumber: 1,
    operatorNote: 'Verify fall-event capacity before approving this response.',
  },
  {
    id: 'draft-foundry-context',
    leadId: 'demo-foundry-house',
    createdAt: '2026-07-25T16:24:00.000Z',
    channel: 'EMAIL',
    subject: 'Re: A cleaner handoff from estimate request to signed project',
    body: 'That distinction makes sense. Leadzilla would sit before the estimating record: qualifying scope, location, timing, and decision readiness, then handing a complete project brief to the estimating team. I am checking which integration example is closest to your current stack before suggesting a walkthrough.',
    status: 'Needs context',
    followUpNumber: 1,
    operatorNote: 'Add the current estimating platform before approval.',
  },
  {
    id: 'draft-luma-nurture',
    leadId: 'demo-luma-gifting',
    createdAt: '2026-07-30T14:03:00.000Z',
    channel: 'EMAIL',
    subject: 'Re: Planning ahead for seasonal corporate orders',
    body: 'Thanks, Sofia — September makes sense. I will keep this focused on qualifying corporate requests before artwork and production planning, rather than changing the fulfillment process. I have left a note to revisit it after Labor Day.',
    status: 'Review on nurture date',
    followUpNumber: 1,
    operatorNote: 'Review September 8. This is not scheduled for delivery.',
  },
] as const;
