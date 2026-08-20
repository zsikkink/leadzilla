export interface DemoIcpPlaybook {
  id: string;
  name: string;
  description: string;
  industries: readonly string[];
  bestFit: string;
  primaryBuyers: string;
  buyingSignals: string;
  salesApproach: string;
  primaryCta: string;
}

export const DEMO_ICP_PLAYBOOKS: readonly DemoIcpPlaybook[] = [
  {
    id: 'multi-location-dental-groups',
    name: 'Multi-Location Dental Groups',
    description:
      'Regional dental and orthodontic groups coordinating patient acquisition and follow-up across multiple practices.',
    industries: ['Dental groups', 'Orthodontics', 'Pediatric dentistry'],
    bestFit: '5–40 practices · 25–500 employees',
    primaryBuyers: 'COO, VP Growth, Director of Marketing',
    buyingSignals: 'New locations, centralized intake, active patient-acquisition campaigns',
    salesApproach:
      'Lead with multi-location pipeline visibility and reducing missed patient follow-up between marketing and front-desk teams.',
    primaryCta: 'Compare one location’s lead-to-booking workflow?',
  },
  {
    id: 'commercial-solar-roofing-contractors',
    name: 'Commercial Solar & Roofing Contractors',
    description:
      'Regional field-service operators selling high-value commercial projects through territory-based sales teams.',
    industries: ['Commercial solar', 'Roofing', 'HVAC and electrical'],
    bestFit: 'Regional operators · 20–400 employees',
    primaryBuyers: 'VP Sales, General Manager, Commercial Director',
    buyingSignals: 'Territory expansion, high-value bids, growing estimator or field-sales teams',
    salesApproach:
      'Lead with speed-to-lead, territory prioritization, and consistent follow-up on high-value estimates and site visits.',
    primaryCta: 'Map one territory’s estimate follow-up process?',
  },
  {
    id: 'boutique-hotels-vacation-rentals',
    name: 'Boutique Hotels & Vacation Rentals',
    description:
      'Independent hospitality portfolios balancing occupancy, guest experience, and direct-booking growth across properties.',
    industries: ['Boutique hotels', 'Vacation rentals', 'Serviced apartments'],
    bestFit: '10–75 properties · 10–250 employees',
    primaryBuyers: 'VP Revenue, Head of Growth, Portfolio GM',
    buyingSignals: 'Portfolio expansion, direct-booking campaigns, fragmented guest inquiry channels',
    salesApproach:
      'Lead with direct-booking conversion and consistent guest follow-up without disrupting property-level operations.',
    primaryCta: 'Review where direct-booking inquiries drop off?',
  },
  {
    id: 'b2b-saas-developer-platforms',
    name: 'B2B SaaS & Developer Platforms',
    description:
      'Technical software vendors selling infrastructure and workflow products to complex, multi-stakeholder buying teams.',
    industries: ['Developer tools', 'Cybersecurity', 'Data infrastructure'],
    bestFit: 'Series A–C or scaled private · 50–1,500 employees',
    primaryBuyers: 'VP Sales, Revenue Operations, Head of Growth',
    buyingSignals: 'New funding, PLG-to-sales motion, expanding enterprise sales team',
    salesApproach:
      'Lead with intent signals and account prioritization for sales-assisted expansion into technical buying committees.',
    primaryCta: 'Review how high-intent accounts reach sales?',
  },
] as const;
