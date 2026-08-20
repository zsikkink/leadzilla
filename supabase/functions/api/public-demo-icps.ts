export interface PublicDemoIcpPresentation {
  sourceName: string;
  name: string;
  description: string;
  targetIndustries: readonly string[];
  minCompanySize: number;
  maxCompanySize: number;
}

export const PUBLIC_DEMO_ICP_PRESENTATIONS: readonly PublicDemoIcpPresentation[] = [
  {
    sourceName: 'Enterprise Workflow & Data Platforms',
    name: 'Enterprise Workflow & Data Platforms',
    description:
      'U.S.-based software companies selling workflow, data, cloud, or security platforms into larger organizations.',
    targetIndustries: [
      'Cloud Software',
      'Cybersecurity',
      'Data Infrastructure',
      'IT Management Software',
    ],
    minCompanySize: 250,
    maxCompanySize: 2000,
  },
  {
    sourceName: 'Mid-Market GTM Teams',
    name: 'Mid-Market GTM Teams',
    description:
      'U.S.-based SaaS companies with established revenue teams, a repeatable sales motion, and enough market presence to support targeted account selection.',
    targetIndustries: [
      'Revenue Operations Software',
      'Sales Software',
      'Marketing Automation',
      'Customer Data Platforms',
    ],
    minCompanySize: 100,
    maxCompanySize: 750,
  },
  {
    sourceName: 'Product-Led B2B SaaS Growth',
    name: 'Product-Led B2B SaaS Growth',
    description:
      'U.S.-based B2B SaaS companies with 25–150 employees that pair self-service acquisition with sales-assisted expansion.',
    targetIndustries: [
      'B2B SaaS',
      'Developer Tools',
      'Collaboration Software',
      'Analytics Software',
    ],
    minCompanySize: 25,
    maxCompanySize: 150,
  },
  {
    sourceName: 'Vertical SaaS Operators',
    name: 'Vertical SaaS Operators',
    description:
      'U.S.-based vertical SaaS companies serving a defined operating market such as healthcare, financial services, HR, or property management.',
    targetIndustries: [
      'Healthcare Software',
      'Financial Software',
      'HR Software',
      'Property Management Software',
    ],
    minCompanySize: 50,
    maxCompanySize: 500,
  },
] as const;

const PRESENTATION_BY_SOURCE_NAME = new Map(
  PUBLIC_DEMO_ICP_PRESENTATIONS.map((presentation) => [presentation.sourceName, presentation]),
);

export function getPublicDemoIcpPresentation(
  sourceName: string | null | undefined,
): PublicDemoIcpPresentation | null {
  return sourceName ? PRESENTATION_BY_SOURCE_NAME.get(sourceName) ?? null : null;
}
