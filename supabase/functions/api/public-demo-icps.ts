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
    name: 'Multi-Location Dental Groups',
    description:
      'Regional dental and orthodontic groups coordinating patient acquisition across multiple practices.',
    targetIndustries: [
      'Dental Group',
      'Orthodontic Practice',
      'Pediatric Dentistry',
      'Oral Surgery Practice',
    ],
    minCompanySize: 25,
    maxCompanySize: 500,
  },
  {
    sourceName: 'Mid-Market GTM Teams',
    name: 'Commercial Solar & Roofing Contractors',
    description:
      'Regional field-service operators selling high-value commercial projects through local sales teams.',
    targetIndustries: [
      'Commercial Solar Contractor',
      'Roofing Contractor',
      'HVAC Contractor',
      'Electrical Contractor',
    ],
    minCompanySize: 20,
    maxCompanySize: 400,
  },
  {
    sourceName: 'Product-Led B2B SaaS Growth',
    name: 'Boutique Hotels & Vacation Rentals',
    description:
      'Independent hospitality portfolios balancing occupancy, guest experience, and direct-booking growth.',
    targetIndustries: [
      'Boutique Hotel',
      'Vacation Rental Management',
      'Serviced Apartment',
      'Resort Operations',
    ],
    minCompanySize: 10,
    maxCompanySize: 250,
  },
  {
    sourceName: 'Vertical SaaS Operators',
    name: 'B2B SaaS & Developer Platforms',
    description:
      'Technical software vendors selling infrastructure and workflow products to complex buying teams.',
    targetIndustries: [
      'Developer Tools Company',
      'Cybersecurity Company',
      'Data Infrastructure Company',
      'Workflow Software Company',
    ],
    minCompanySize: 50,
    maxCompanySize: 1500,
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
