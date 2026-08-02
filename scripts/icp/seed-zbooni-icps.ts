import { prisma } from '@lead-flood/db';

const UNITED_STATES = ['US'] as const;

interface QualificationRuleDefinition {
  name: string;
  fieldName: string;
  operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'CONTAINS';
  expectedValue: unknown;
  isRequired: boolean;
  weight: number;
  orderIndex: number;
}

interface DemoIcpDefinition {
  name: string;
  legacySourceName: string;
  purpose: string;
  targetIndustries: string[];
  minCompanySize: number;
  maxCompanySize: number;
  featureList: string[];
  metadata: Record<string, unknown>;
  rules: QualificationRuleDefinition[];
}

const baselineRules = (): QualificationRuleDefinition[] => [
  {
    name: 'United States market',
    fieldName: 'country',
    operator: 'IN',
    expectedValue: [...UNITED_STATES],
    isRequired: true,
    weight: 0,
    orderIndex: 1,
  },
  {
    name: 'Company domain available',
    fieldName: 'has_domain',
    operator: 'EQ',
    expectedValue: true,
    isRequired: true,
    weight: 0,
    orderIndex: 2,
  },
  {
    name: 'Business email available',
    fieldName: 'has_email',
    operator: 'EQ',
    expectedValue: true,
    isRequired: true,
    weight: 0,
    orderIndex: 3,
  },
];

const antiFitRule = (orderIndex: number): QualificationRuleDefinition => ({
  name: 'Consumer ecommerce anti-fit',
  fieldName: 'pure_self_serve_ecom',
  operator: 'EQ',
  expectedValue: true,
  isRequired: false,
  weight: -3,
  orderIndex,
});

export const DEMO_ICP_DEFINITIONS: readonly DemoIcpDefinition[] = [
  {
    name: 'Product-Led B2B SaaS Growth',
    legacySourceName: 'High-Ticket Coaching & Advisory',
    purpose:
      'U.S.-based B2B SaaS companies with 25–150 employees that pair self-service acquisition with sales-assisted expansion. This profile prioritizes visible product signals, a contactable buying team, and clear commercial intent.',
    targetIndustries: [
      'B2B SaaS',
      'Developer Tools',
      'Collaboration Software',
      'Analytics Software',
    ],
    minCompanySize: 25,
    maxCompanySize: 150,
    featureList: [
      'Account research grounded in public company evidence',
      'Fit scoring that separates immediate review from nurture',
      'Decision-maker discovery across a growing buying committee',
      'Human-reviewed outreach drafts with account context preserved',
    ],
    metadata: {
      priority: 'P1',
      strategy: 'generic_b2b_saas',
      salesHook:
        'When product-led volume outpaces manual qualification, the next operating question is which accounts merit a sales-assisted follow-up.',
      salesAngles: [
        'Trial-to-sales handoff',
        'High-intent account prioritization',
        'Buying-committee context',
      ],
      averageTicket: 'Mid-market ACV',
      volumePotential: 'High',
      salesCycle: '30–60 days',
      revenuePotential: 'High',
    },
    rules: [
      ...baselineRules(),
      {
        name: 'Pricing page detected',
        fieldName: 'apify_has_pricing_tiers',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 3,
        orderIndex: 4,
      },
      {
        name: 'Analytics instrumentation detected',
        fieldName: 'has_analytics',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 2,
        orderIndex: 5,
      },
      {
        name: 'Decision-maker identified',
        fieldName: 'decision_maker_count',
        operator: 'GT',
        expectedValue: 0,
        isRequired: false,
        weight: 3,
        orderIndex: 6,
      },
      antiFitRule(7),
    ],
  },
  {
    name: 'Mid-Market GTM Teams',
    legacySourceName: 'Home, Design & High-Value Contracting',
    purpose:
      'U.S.-based SaaS companies with established revenue teams, a repeatable sales motion, and enough market presence to support targeted account selection. Strong candidates show a visible go-to-market stack and multiple commercial stakeholders.',
    targetIndustries: [
      'Revenue Operations Software',
      'Sales Software',
      'Marketing Automation',
      'Customer Data Platforms',
    ],
    minCompanySize: 100,
    maxCompanySize: 750,
    featureList: [
      'Segment-level account selection for focused pipeline creation',
      'Contact enrichment that consolidates commercial context',
      'Score explanations that make prioritization reviewable',
      'Draft generation that keeps operators in control of outreach',
    ],
    metadata: {
      priority: 'P1',
      strategy: 'generic_b2b_saas',
      salesHook:
        'Established revenue teams need a reliable way to decide where research time will create the most pipeline leverage.',
      salesAngles: ['Revenue-team capacity', 'Account prioritization', 'Multi-threaded outreach'],
      averageTicket: 'Mid-market to enterprise ACV',
      volumePotential: 'Medium–High',
      salesCycle: '45–90 days',
      revenuePotential: 'High',
    },
    rules: [
      ...baselineRules(),
      {
        name: 'CRM footprint detected',
        fieldName: 'has_crm',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 3,
        orderIndex: 4,
      },
      {
        name: 'LinkedIn company presence',
        fieldName: 'has_linkedin',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 2,
        orderIndex: 5,
      },
      {
        name: 'Broad technology footprint',
        fieldName: 'tech_stack_size',
        operator: 'GT',
        expectedValue: 5,
        isRequired: false,
        weight: 2,
        orderIndex: 6,
      },
      {
        name: 'Senior commercial contact identified',
        fieldName: 'found_csuite_decision_maker',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 3,
        orderIndex: 7,
      },
      antiFitRule(8),
    ],
  },
  {
    name: 'Vertical SaaS Operators',
    legacySourceName: 'Premium Wellness & Longevity Clinics',
    purpose:
      'U.S.-based vertical SaaS companies serving a defined operating market such as healthcare, financial services, HR, or property management. The profile favors companies with an established platform, public product positioning, and a clear path to commercial scale.',
    targetIndustries: [
      'Healthcare Software',
      'Financial Software',
      'HR Software',
      'Property Management Software',
    ],
    minCompanySize: 50,
    maxCompanySize: 500,
    featureList: [
      'Industry-specific account research and qualification',
      'Signal-based prioritization across specialized markets',
      'Decision-maker and company enrichment in one workflow',
      'Evidence-led messaging drafts for operator approval',
    ],
    metadata: {
      priority: 'P2',
      strategy: 'generic_b2b_saas',
      salesHook:
        'Vertical SaaS teams often have a well-defined market but limited time to translate fragmented public signals into a focused account list.',
      salesAngles: [
        'Vertical-market precision',
        'Commercial signal capture',
        'Focused expansion accounts',
      ],
      averageTicket: 'Vertical SaaS ACV',
      volumePotential: 'Medium',
      salesCycle: '45–90 days',
      revenuePotential: 'Medium–High',
    },
    rules: [
      ...baselineRules(),
      {
        name: 'Pricing page detected',
        fieldName: 'apify_has_pricing_tiers',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 3,
        orderIndex: 4,
      },
      {
        name: 'Product contact path detected',
        fieldName: 'has_booking_or_contact_form',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 2,
        orderIndex: 5,
      },
      {
        name: 'Active company presence',
        fieldName: 'recent_activity',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 2,
        orderIndex: 6,
      },
      {
        name: 'Decision-maker identified',
        fieldName: 'decision_maker_count',
        operator: 'GT',
        expectedValue: 0,
        isRequired: false,
        weight: 3,
        orderIndex: 7,
      },
      antiFitRule(8),
    ],
  },
  {
    name: 'Enterprise Workflow & Data Platforms',
    legacySourceName: 'Gifting, Corporate & Bespoke Experiences',
    purpose:
      'U.S.-based software companies selling workflow, data, cloud, or security platforms into larger organizations. This profile focuses on companies with a deeper technology footprint and enough public evidence to support a measured enterprise account motion.',
    targetIndustries: [
      'Cloud Software',
      'Cybersecurity',
      'Data Infrastructure',
      'IT Management Software',
    ],
    minCompanySize: 250,
    maxCompanySize: 2000,
    featureList: [
      'Research-backed account briefs for complex buying teams',
      'Fit scoring that highlights enterprise-commercial readiness',
      'Contact enrichment across technical and business stakeholders',
      'Draft assistance that preserves evidence and human review',
    ],
    metadata: {
      priority: 'P1',
      strategy: 'generic_b2b_saas',
      salesHook:
        'Enterprise motions need fewer assumptions and better account context before a team commits scarce research and outreach capacity.',
      salesAngles: [
        'Enterprise account context',
        'Technical and commercial stakeholders',
        'Evidence-backed prioritization',
      ],
      averageTicket: 'Enterprise ACV',
      volumePotential: 'Selective',
      salesCycle: '90–180 days',
      revenuePotential: 'Very High',
    },
    rules: [
      ...baselineRules(),
      {
        name: 'Broad technology footprint',
        fieldName: 'tech_stack_size',
        operator: 'GT',
        expectedValue: 8,
        isRequired: false,
        weight: 3,
        orderIndex: 4,
      },
      {
        name: 'CRM footprint detected',
        fieldName: 'has_crm',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 2,
        orderIndex: 5,
      },
      {
        name: 'Multiple public company channels',
        fieldName: 'social_link_count',
        operator: 'GT',
        expectedValue: 2,
        isRequired: false,
        weight: 2,
        orderIndex: 6,
      },
      {
        name: 'Senior commercial contact identified',
        fieldName: 'found_csuite_decision_maker',
        operator: 'EQ',
        expectedValue: true,
        isRequired: false,
        weight: 3,
        orderIndex: 7,
      },
      antiFitRule(8),
    ],
  },
] as const;

const LEGACY_ICP_NAMES = [
  'Boutique Hospitality & Short-Stay Operators',
  'Digital Gift Card Reseller - Multi-Brand Marketplace',
  'Education & Training Providers',
  'Events, Weddings & Experiential Operators',
  'Gifting, Corporate & Bespoke Experiences',
  'High-Ticket Coaching & Advisory',
  'Home, Design & High-Value Contracting',
  'Luxury & High-Ticket Services',
  'Premium Wellness & Longevity Clinics',
  'UAE After-School Activity Providers',
  'Chat-First SMB Seller',
  'High-Touch Service Business',
  'Shopify / Ecommerce Recovery',
  'Multi-Rep SMB Growth',
] as const;

export interface SeedResult {
  activeIcpCount: number;
  archivedIcpCount: number;
  ruleCountsByIcp: Array<{ icpName: string; icpProfileId: string; ruleCount: number }>;
}

export async function seedDemoIcps(): Promise<SeedResult> {
  const summary: SeedResult = {
    activeIcpCount: 0,
    archivedIcpCount: 0,
    ruleCountsByIcp: [],
  };

  for (const definition of DEMO_ICP_DEFINITIONS) {
    const [existingDemoIcp, legacyIcp] = await Promise.all([
      prisma.icpProfile.findFirst({ where: { name: definition.name }, select: { id: true } }),
      prisma.icpProfile.findFirst({
        where: { name: definition.legacySourceName },
        select: { id: true },
      }),
    ]);
    const sourceIcp = existingDemoIcp ?? legacyIcp;
    const icpData = {
      name: definition.name,
      description: definition.purpose,
      qualificationLogic: 'WEIGHTED' as const,
      metadataJson: {
        seededBy: 'scripts/icp/seed-demo-icps.ts',
        ...definition.metadata,
      },
      targetCountries: [...UNITED_STATES],
      targetIndustries: definition.targetIndustries,
      minCompanySize: definition.minCompanySize,
      maxCompanySize: definition.maxCompanySize,
      requiredTechnologies: [],
      excludedDomains: [],
      featureList: definition.featureList,
      isActive: true,
      createdByUserId: null,
    };
    const icp = sourceIcp
      ? await prisma.icpProfile.update({ where: { id: sourceIcp.id }, data: icpData })
      : await prisma.icpProfile.create({ data: icpData });

    await prisma.qualificationRule.deleteMany({ where: { icpProfileId: icp.id } });
    await prisma.qualificationRule.createMany({
      data: definition.rules.map((rule) => ({
        icpProfileId: icp.id,
        name: rule.name,
        ruleType: rule.isRequired ? 'HARD_FILTER' : 'WEIGHTED',
        isRequired: rule.isRequired,
        fieldKey: rule.fieldName,
        operator: rule.operator,
        valueJson: rule.expectedValue as never,
        weight: rule.isRequired ? null : rule.weight,
        orderIndex: rule.orderIndex,
        priority: rule.orderIndex,
        isActive: true,
      })),
    });

    summary.activeIcpCount += 1;
    summary.ruleCountsByIcp.push({
      icpName: definition.name,
      icpProfileId: icp.id,
      ruleCount: definition.rules.length,
    });
  }

  const remainingLegacyProfiles = await prisma.icpProfile.findMany({
    where: { name: { in: [...LEGACY_ICP_NAMES] } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (remainingLegacyProfiles.length > 0) {
    await prisma.qualificationRule.deleteMany({
      where: { icpProfileId: { in: remainingLegacyProfiles.map((profile) => profile.id) } },
    });
    await Promise.all(
      remainingLegacyProfiles.map((profile, index) =>
        prisma.icpProfile.update({
          where: { id: profile.id },
          data: {
            name: `Archived demo profile ${index + 1}`,
            description: 'Historical demo data retained for reporting continuity.',
            metadataJson: { demoArchive: true },
            targetCountries: [],
            targetIndustries: [],
            minCompanySize: null,
            maxCompanySize: null,
            requiredTechnologies: [],
            excludedDomains: [],
            featureList: [],
            isActive: false,
          },
        }),
      ),
    );
    summary.archivedIcpCount = remainingLegacyProfiles.length;
  }

  return summary;
}

async function run(): Promise<void> {
  const result = await seedDemoIcps();
  console.log(JSON.stringify({ event: 'icp.seed.completed', ...result }, null, 2));
}

run()
  .catch((error: unknown) => {
    console.error('Failed to seed demo ICP profiles', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
