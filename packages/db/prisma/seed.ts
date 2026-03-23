import prismaClientPkg from '@prisma/client';

const { PrismaClient } = prismaClientPkg;

const prisma = new PrismaClient();

// All MENA countries as default target (friendly names matching QualificationRule valueJson)
const MENA_COUNTRIES = [
  'UAE', 'KSA', 'Egypt', 'Jordan', 'Bahrain', 'Kuwait', 'Oman', 'Qatar',
  'Lebanon', 'Iraq', 'Morocco', 'Tunisia', 'Algeria', 'Libya', 'Yemen',
  'Syria', 'Palestine', 'Sudan',
];

// Supported countries for qualification HARD_FILTER rules (friendly names)
const SUPPORTED_COUNTRIES = [...MENA_COUNTRIES];

// ── Qualification Rule Definition ──────────────────────────────
interface QualificationRuleDef {
  name: string;
  fieldKey: string;
  operator: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IN' | 'NOT_IN' | 'CONTAINS';
  expectedValue: unknown;
  isRequired: boolean;
  weight: number;
  orderIndex: number;
}

// ── Universal Qualification Rules (identical for all 8 segments) ──────
// Zero conversion data → no basis for segment-specific weights. Start uniform, let ML learn.
const UNIVERSAL_RULES: QualificationRuleDef[] = [
  // HARD_FILTERs (5)
  { name: 'Country in supported MENA region', fieldKey: 'country', operator: 'IN', expectedValue: [...SUPPORTED_COUNTRIES], isRequired: true, weight: 0, orderIndex: 1 },
  { name: 'Has email contact', fieldKey: 'has_email', operator: 'EQ', expectedValue: true, isRequired: true, weight: 0, orderIndex: 2 },
  { name: 'Data alignment score above threshold', fieldKey: 'data_alignment_score', operator: 'GTE', expectedValue: 0.3, isRequired: true, weight: 0, orderIndex: 3 },
  { name: 'Pure self-serve ecom (disqualify)', fieldKey: 'pure_self_serve_ecom', operator: 'NEQ', expectedValue: true, isRequired: true, weight: 0, orderIndex: 4 },
  { name: 'Subscription or recurring billing (disqualify)', fieldKey: 'subscription_billing_detected', operator: 'NEQ', expectedValue: true, isRequired: true, weight: 0, orderIndex: 5 },
  // Positive rules (11, total weight = 19)
  // Removed dead features (0% detection): industry_supported (w3), deposit_milestone_signals (w2), bank_transfer_reliance (w2), instagram_has_business_email (w1)
  { name: 'Has WhatsApp presence', fieldKey: 'has_whatsapp', operator: 'EQ', expectedValue: true, isRequired: false, weight: 3, orderIndex: 6 },
  { name: 'Has Instagram presence', fieldKey: 'has_instagram', operator: 'EQ', expectedValue: true, isRequired: false, weight: 2, orderIndex: 7 },
  { name: 'Review count above 10', fieldKey: 'review_count', operator: 'GT', expectedValue: 10, isRequired: false, weight: 2, orderIndex: 8 },
  { name: 'Custom order signals', fieldKey: 'custom_order_signals', operator: 'EQ', expectedValue: true, isRequired: false, weight: 2, orderIndex: 9 },
  { name: 'Has booking or contact form', fieldKey: 'has_booking_or_contact_form', operator: 'EQ', expectedValue: true, isRequired: false, weight: 2, orderIndex: 10 },
  { name: 'Recent activity detected', fieldKey: 'recent_activity', operator: 'EQ', expectedValue: true, isRequired: false, weight: 1, orderIndex: 11 },
  { name: 'Payment widgets detected', fieldKey: 'apify_payment_widget_count', operator: 'GT', expectedValue: 0, isRequired: false, weight: 1, orderIndex: 12 },
  { name: 'Has pricing tiers', fieldKey: 'apify_has_pricing_tiers', operator: 'EQ', expectedValue: true, isRequired: false, weight: 1, orderIndex: 13 },
  { name: 'Multiple social profiles', fieldKey: 'social_link_count', operator: 'GT', expectedValue: 2, isRequired: false, weight: 1, orderIndex: 14 },
  { name: 'High-ticket signals', fieldKey: 'high_ticket_signals', operator: 'EQ', expectedValue: true, isRequired: false, weight: 2, orderIndex: 15 },
  { name: 'P1 priority segment', fieldKey: 'icp_segment_priority', operator: 'GTE', expectedValue: 2, isRequired: false, weight: 2, orderIndex: 16 },
];

// ── 8 ICP Segments from Zbooni Sales Onboarding Deck ──────────
const ICP_SEGMENTS = [
  {
    name: 'Luxury & High-Ticket Services',
    description: `Premium, service-led businesses in the luxury segment — yacht & superyacht charter companies, exotic & luxury car rental fleets, private aviation brokers & charter services, luxury travel designers & concierge firms, and personal shoppers/stylists serving HNWIs.

Core Pain Points: Failed payments on high-value transactions (Amex/ApplePay declines kill bookings), single-MID dependency causing transaction failures, reliance on bank transfers with poor UX, manual reconciliation and poor visibility per agent or project, delayed settlements impacting cash flow, slow PSP onboarding killing deal momentum, difficulty collecting deposits or partial payments from international clients.

Why Zbooni: Chat-based payments with no integrations needed, multiple payment methods and smart routing via 20+ MIDs, branded links with instant confirmation, faster cash collection and higher approval rates, clear reconciliation and auditable reporting, hands-on human support aligned with their high-touch workflow.

Buying Triggers: Growth in WhatsApp or Instagram inquiries, seasonal volume spikes, complaints about failed payments or blocked funds, expansion into international markets, finance pushback on reconciliation complexity.

Objections to Overcome: "We already have a PSP" — Zbooni runs alongside, not instead of. Focus on the deals that fail today. "Our clients prefer bank transfers" — Zbooni branded links feel premium, not like a downgrade. International clients actually prefer card. "It's too expensive" — a single recovered failed payment covers months of Zbooni fees.

Deal Structure: Average ticket AED 5,000–100,000. Short sales cycle. Medium ops complexity. Very high revenue potential. P1 priority segment.`,
    targetIndustries: ['Luxury Services', 'Yacht Charter', 'Private Aviation', 'Luxury Travel', 'Personal Shopping'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 5,
    maxCompanySize: 200,
    featureList: ['Large one-off payments (up to AED 1M per link)', 'Multiple payment methods (Amex, Apple Pay, Google Pay, PayPal)', 'Multi-MID support for failed transaction retries (20+ MIDs)', 'Immediate live support via call or WhatsApp', 'Catalog (CShop) to pre-list services', 'CRM to track customer order history'],
    metadataJson: { priority: 'P1', avgTicket: 'Very High (AED 5,000–100,000)', volumePotential: 'Medium', salesCycle: 'Short', opsComplexity: 'Medium', revenuePotential: 'Very High', hook: 'Most of our customers use WhatsApp to close high-value deals but struggle when payments fail or clients are international.', angle: ['One payment link up to AED 1M', 'Multi-MID retries if a transaction fails', 'Live support when timing matters'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Gifting, Corporate & Bespoke Experiences',
    description: `Premium corporate gifting houses (B2B contracts), curated gift box brands (seasonal & bulk), high-end florists (events, weddings, corporate), and experience gifting platforms (vouchers, packages, activations).

Core Pain Points: Seasonal volume spikes overwhelm manual processes, multiple agents handling sales with no centralized tracking, quoting and revisions happening in WhatsApp with no payment linkage, deposits and balance payments required but hard to track, promo code and discount management is manual, difficulty scaling during peak periods (Ramadan, National Day, Valentine's, corporate year-end).

Why Zbooni: Catalog (CShop) to pre-list services and share directly via chat, live payment link editing without creating new links (updates reflected instantly), in-app discount and promo code creation, WhatsApp marketing campaigns for customer acquisition (via Zbooni verified number or merchant's number), multiple payment methods for frictionless checkout, centralized tracking across all agents.

Buying Triggers: Approaching seasonal peak (Ramadan, National Day, Valentine's, Mother's Day), complaints about lost orders during busy periods, multiple agents/staff with no unified view, expansion into corporate B2B gifting contracts.

Objections to Overcome: "We only get busy a few times a year" — that's exactly when you can't afford payment friction. One lost bulk order = months of Zbooni fees. "We use Instagram DMs" — Zbooni connects your Instagram flow to actual payments. No copy-pasting bank details. "Our volumes are small" — your PEAK volumes aren't. Prepare infrastructure for the spike.

Deal Structure: Average ticket Medium–High. High volume (seasonal). Short–Medium sales cycle. Medium ops complexity. High revenue potential. P1 priority.`,
    targetIndustries: ['Corporate Gifting', 'Florists', 'Gift Boxes', 'Experience Platforms', 'Bespoke Events'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 5,
    maxCompanySize: 300,
    featureList: ['Catalog (CShop) for pre-listing services', 'Live payment link editing', 'In-app discount creation', 'Promo code management', 'WhatsApp marketing campaigns via Zbooni verified number', 'Multiple payment methods'],
    metadataJson: { priority: 'P1', avgTicket: 'Medium–High', volumePotential: 'High (seasonal)', salesCycle: 'Short–Medium', opsComplexity: 'Medium', revenuePotential: 'High', hook: 'We work with brands handling seasonal spikes, bulk orders, and multiple agents selling at once.', angle: ['Catalog + payment links inside WhatsApp', 'Promo codes & campaigns for peak periods', 'Centralized tracking across agents'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Events, Weddings & Experiential Operators',
    description: `Wedding planners & destination wedding agencies, event production & creative agencies, exhibition & expo organizers, pop-up markets & seasonal event operators, and festival & experiential brand activations.

Core Pain Points: Large upfront deposits (30–70%) with multiple stakeholders paying from different locations, revenue attribution by event/agent/project is nearly impossible, time-sensitive payments with zero tolerance for delays (venues, vendors, performers all need instant confirmation), fragmented payment collection across vendors and clients, manual reconciliation across multiple payment sources, no centralized view of who paid what for which event.

Why Zbooni: End-to-end event marketing management via WhatsApp using Zbooni data, ticketing solution to issue/manage/track event entry tickets, Catalog (CShop) to pre-list products or services and share directly via chat or QR code, QR-based food ordering and payment solution (reduce queues, route orders to vendors), POS machine for in-person card acceptance, customer database for tracking and re-engagement in future editions, master organizer dashboard for sales and performance across all vendors, promo code creation and management.

Buying Triggers: Upcoming major event with complex payment requirements, expansion into multi-vendor events, complaints about delayed payments disrupting event logistics, need for ticketing + payment in one solution.

Objections to Overcome: "We use Eventbrite/TicketTailor" — those don't handle WhatsApp-based vendor payments, deposits, or multi-stakeholder flows. "Our events are seasonal" — that's when payment failure costs the most. Prepare the infrastructure. "We already take bank transfers" — your international vendors and attendees don't want to wire money. Cards are faster and confirmed instantly.

Deal Structure: Average ticket High. High volume (event-based). Medium sales cycle. High ops complexity. Very high revenue potential. P1 priority.`,
    targetIndustries: ['Wedding Planning', 'Event Production', 'Exhibitions', 'Pop-up Markets', 'Festivals'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 3,
    maxCompanySize: 500,
    featureList: ['End-to-end event marketing via WhatsApp', 'Ticketing solution', 'Catalog (CShop) for products/services', 'QR-based food ordering and payment', 'POS machine for in-person cards', 'Customer database for re-engagement', 'Master organizer dashboard', 'Promo codes'],
    metadataJson: { priority: 'P1', avgTicket: 'High', volumePotential: 'High (event-based)', salesCycle: 'Medium', opsComplexity: 'High', revenuePotential: 'Very High', hook: 'Events fail when payments are delayed or fragmented — especially with multiple vendors and stakeholders.', angle: ['Ticketing, QR payments, food ordering', 'Master dashboard for organizers', 'WhatsApp marketing + re-engagement'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Home, Design & High-Value Contracting',
    description: `Interior design studios, renovation & fit-out firms, architecture & landscape design companies, and premium maintenance & contracting groups.

Core Pain Points: Proposal-based selling with milestone & staged payments that are difficult to manage, heavy WhatsApp coordination for project updates and payment collection, poor reconciliation with bank transfers (hard to track what was paid by whom for which project), clients paying remotely with no clean digital payment experience, VAT tracking and receipt generation is manual, difficulty collecting deposits or progress payments without friction.

Why Zbooni: Support for large one-off payments on a single link (up to AED 1M per link), customizable milestone-based payment links allowing partial payments based on project stages with ability to add images and descriptions, easy reconciliation to track payments/customers/VAT, customizable instant customer receipt generation, Catalog (CShop) to pre-list services and share directly via chat, CRM to track customer order history and add internal notes, in-app discount creation.

Buying Triggers: Finance pushback on reconciliation complexity, complaints about delayed bank transfers affecting project timelines, expansion into higher-value projects requiring structured payment collection, international clients requesting card payment options.

Objections to Overcome: "Our clients pay by bank transfer" — Zbooni doesn't replace bank transfers; it gives you a faster option when timing matters. Milestone links are cleaner than chasing wire confirmations. "We're not a tech company" — that's the point. Zbooni requires zero integration. Share a link in WhatsApp, get paid. "Our projects take months" — even better. Milestone payments with automatic receipts and reconciliation save hours per project.

Deal Structure: Average ticket High. Medium volume. Medium–Long sales cycle. Medium ops complexity. High revenue potential. P1 priority.`,
    targetIndustries: ['Interior Design', 'Renovation', 'Architecture', 'Contracting', 'Landscape Design'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 5,
    maxCompanySize: 500,
    featureList: ['Large one-off payments (up to AED 1M)', 'Customizable milestone-based payment links', 'Easy reconciliation with VAT tracking', 'Customizable instant receipts', 'Catalog (CShop)', 'CRM with order history and notes', 'In-app discount creation'],
    metadataJson: { priority: 'P1', avgTicket: 'High', volumePotential: 'Medium', salesCycle: 'Medium–Long', opsComplexity: 'Medium', revenuePotential: 'High', hook: 'We help firms replace bank transfers with clean, staged card payments.', angle: ['Milestone-based payment links', 'Easy reconciliation & VAT tracking', 'Partial payments + receipts'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Boutique Hospitality & Short-Stay Operators',
    description: `Boutique hospitality groups, holiday home operators & serviced residences, and property management firms offering add-on services (cleaning, concierge, experiences).

Core Pain Points: High-value bookings with deposits and balance payments that are hard to collect remotely, international guests paying from abroad with unreliable bank transfer UX, heavy WhatsApp communication pre-arrival for booking confirmations and add-ons, add-on services sold before and during the stay are tracked manually, no centralized guest history across properties, reconciliation across multiple properties and payment sources is spreadsheet-based.

Why Zbooni: Support for large one-off payments on a single link (up to AED 1M per link), customizable payment links for partial payments (deposit/balance/add-ons), international card acceptance for guests worldwide, multiple payment methods (Amex, Apple Pay, Google Pay, PayPal, etc.), instant customer receipt generation, easy reconciliation to track payments/customers/VAT, Catalog (CShop) to pre-list services and upsells and share via chat or QR code, CRM to track guest history/preferences and add internal notes.

Buying Triggers: Seasonal booking spikes (winter season, holidays), complaints about failed international card payments, expansion into new properties needing unified payment, guests requesting modern payment options beyond bank transfer, finance pushback on manual reconciliation per property.

Objections to Overcome: "We use Airbnb/Booking.com" — Zbooni handles the direct bookings and add-ons that OTAs don't cover. Your margin is better on direct. "Our guests prefer bank transfers" — international guests don't. Multi-currency card payment with instant confirmation converts better. "We already have a PMS" — Zbooni doesn't replace your PMS. It handles the payment collection that your PMS can't do via WhatsApp.

Deal Structure: Average ticket Medium–High. High volume. Short sales cycle. Medium ops complexity. High revenue potential. P1 priority.`,
    targetIndustries: ['Boutique Hotels', 'Holiday Homes', 'Serviced Residences', 'Property Management', 'Hospitality'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 3,
    maxCompanySize: 200,
    featureList: ['Large one-off payments (up to AED 1M)', 'Partial payments (deposit/balance/add-ons)', 'International card acceptance', 'Multiple payment methods', 'Instant receipts', 'Easy reconciliation with VAT', 'Catalog for upsells via chat/QR', 'CRM for guest history'],
    metadataJson: { priority: 'P1', avgTicket: 'Medium–High', volumePotential: 'High', salesCycle: 'Short', opsComplexity: 'Medium', revenuePotential: 'High', hook: 'Guests want to pay instantly, remotely, and securely before arrival.', angle: ['Deposits, balances, and upsells via WhatsApp', 'Multi-currency + international cards', 'Guest CRM & reconciliation'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Premium Wellness & Longevity Clinics',
    description: `Premium wellness clinics, aesthetic & cosmetic treatment centres, and longevity/IV therapy/advanced diagnostics clinics.

Core Pain Points: High-ticket treatment packages requiring deposits to secure appointments, international and medical-tourism clients needing reliable cross-border payment options, need for trust/confirmation/smooth payment experience (clinics can't afford payment failures mid-treatment plan), compliance requirements for medical billing and receipts, managing package-based pricing with multiple sessions, patient CRM scattered across systems with no unified view.

Why Zbooni: Customizable payment links allowing staged or package-based payments (pay per session or full package upfront), multiple payment methods (Amex, Apple Pay, Google Pay, PayPal, Tabby, Tamara etc.) including BNPL for high-ticket packages, CRM to track patient history/purchases and internal notes, promo code and discount creation for campaigns or referrals, WhatsApp marketing campaigns to promote services and re-engage past patients, instant customer receipt generation, international card acceptance for medical tourism clients.

Buying Triggers: Growth in medical tourism inquiries requiring international payments, complaints about failed payments or slow confirmations disrupting appointment flow, expansion into new treatment packages needing structured payment collection, seasonal promotions requiring discount/promo infrastructure.

Objections to Overcome: "We use our clinic management system for payments" — most CMS tools don't handle WhatsApp-based collection, international cards, or BNPL. Zbooni fills the gap. "Our patients pay at reception" — your medical tourism patients don't. Remote deposits and package payments need a better solution than bank transfers. "We need healthcare-specific compliance" — Zbooni provides instant receipts, audit trails, and reconciliation that meet standard compliance needs.

Deal Structure: Average ticket High. Medium volume. Medium sales cycle. High ops complexity (compliance). Medium–High revenue potential. P2 priority.`,
    targetIndustries: ['Wellness Clinics', 'Aesthetic Medicine', 'Longevity', 'IV Therapy', 'Medical Tourism'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 5,
    maxCompanySize: 100,
    featureList: ['Staged or package-based payment links', 'Multiple payment methods (incl. Tabby, Tamara)', 'CRM for patient history and notes', 'Promo codes for campaigns/referrals', 'WhatsApp marketing campaigns', 'Instant receipts', 'International card acceptance'],
    metadataJson: { priority: 'P2', avgTicket: 'High', volumePotential: 'Medium', salesCycle: 'Medium', opsComplexity: 'High (compliance)', revenuePotential: 'Medium–High', hook: 'Clinics lose time when payments fail or confirmations aren\'t instant.', angle: ['High-ticket package payments', 'Multi-MID retry logic', 'Human support for urgent cases'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'High-Ticket Coaching & Advisory',
    description: `Executive coaches & consultants, business advisory firms, paid communities/masterminds/memberships, and high-ticket program operators.

Core Pain Points: High-ticket programs and retainers collected via WhatsApp conversations with no clean payment flow, deposits/instalments/milestone-based payments are awkward to manage manually, relationship-driven sales process that needs personal touch (not a checkout page), international clients paying across borders with unreliable bank transfers, no unified CRM view of client enrollment/payment history across programs, difficulty re-engaging past clients for new programs or cohorts.

Why Zbooni: Customizable payment links allowing partial or staged payments (deposits, installments, milestone-based), international card acceptance for global client base, multiple payment methods (Amex, Apple Pay, Google Pay, PayPal, Tabby, Tamara etc.), instant customer receipt generation, CRM to track client history/program enrollment and notes, promo code and discount creation for cohorts or referrals, WhatsApp marketing campaigns to re-engage past clients for new programs.

Buying Triggers: Launch of a new high-ticket program or mastermind, growth in international client inquiries, complaints about manual payment tracking across clients, expansion from 1:1 coaching to group programs needing structured payments.

Objections to Overcome: "I just send bank details in WhatsApp" — and then you chase confirmations for days. A branded payment link closes in seconds and confirms instantly. "My ticket size is too high for card" — Zbooni supports up to AED 1M per link. Even retainers at AED 25K+ work smoothly. "I don't need technology" — you don't need technology. You need to stop losing deals to payment friction. Zbooni is as simple as sharing a WhatsApp message.

Deal Structure: Average ticket Medium–High. Medium volume. Short sales cycle. Low ops complexity. Medium revenue potential. P2 priority.`,
    targetIndustries: ['Executive Coaching', 'Business Advisory', 'Masterminds', 'Memberships', 'Consulting'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 1,
    maxCompanySize: 50,
    featureList: ['Partial or staged payment links', 'International card acceptance', 'Multiple payment methods (incl. Tabby, Tamara)', 'Instant receipts', 'CRM for client history and enrolment', 'Promo codes for cohorts/referrals', 'WhatsApp marketing for re-engagement'],
    metadataJson: { priority: 'P2', avgTicket: 'Medium–High', volumePotential: 'Medium', salesCycle: 'Short', opsComplexity: 'Low', revenuePotential: 'Medium', hook: 'High-ticket programs close in conversations, not on websites.', angle: ['Staged payments & cohorts', 'CRM + re-engagement campaigns', 'Simple reconciliation'] },
    rules: UNIVERSAL_RULES,
  },
  {
    name: 'Education & Training Providers',
    description: `Private education institutes, professional training centres, bootcamps/certifications/cohort-based programs, and online-offline hybrid learning providers.

Core Pain Points: Package-based pricing and cohorts requiring deposits to secure seats, multiple students paying remotely (often parents paying for children), strong need for reconciliation and tracking (who paid, for which course, installment status), promo codes and early-bird discounts managed manually, difficulty promoting new cohorts and intakes to past students, no unified view of student enrollment/payment status across programs.

Why Zbooni: Multiple payment methods (Amex, Apple Pay, Google Pay, PayPal, Tabby, Tamara etc.) — critical for parent payments and installments, inventory limits to limit attendance of service (seat caps), instant customer receipt generation for institutional records, easy reconciliation to track payments/students/VAT, CRM to track student enrollment/payment status and notes, promo code creation for early-bird or partner discounts, WhatsApp marketing campaigns to promote new cohorts and intakes.

Buying Triggers: Launch of new courses or certification programs needing payment infrastructure, growth in enrollment requiring structured payment collection, complaints about manual tracking of student payments and installments, expansion into new markets or online delivery requiring remote payment capability.

Objections to Overcome: "We use our LMS for payments" — most LMS payment modules don't support WhatsApp collection, partial payments, or BNPL. Zbooni handles what your LMS can't. "Students pay by bank transfer" — parents and international students want modern payment options. BNPL (Tabby/Tamara) significantly increases enrollment conversion. "Our class sizes are small" — perfect. High-ticket programs with small cohorts mean every lost enrollment hurts. Frictionless payments = higher conversion.

Deal Structure: Average ticket Medium. High volume (cohorts). Medium sales cycle. Medium ops complexity. Medium revenue potential. P2 priority.`,
    targetIndustries: ['Private Education', 'Professional Training', 'Bootcamps', 'Certifications', 'Cohort Programs'],
    targetCountries: MENA_COUNTRIES,
    minCompanySize: 5,
    maxCompanySize: 300,
    featureList: ['Multiple payment methods (incl. Tabby, Tamara)', 'Inventory limits for attendance', 'Instant receipts', 'Reconciliation with student/VAT tracking', 'CRM for student enrolment and notes', 'Promo codes for early-bird/partner discounts', 'WhatsApp campaigns for new cohorts'],
    metadataJson: { priority: 'P2', avgTicket: 'Medium', volumePotential: 'High (cohorts)', salesCycle: 'Medium', opsComplexity: 'Medium', revenuePotential: 'Medium', hook: 'Managing deposits, cohorts, and tracking payments shouldn\'t be manual.', angle: ['Seat-based payments', 'Promo codes & intakes', 'Student tracking + reconciliation'] },
    rules: UNIVERSAL_RULES,
  },
];

// Priority boost: P1 segments get +0.15 deterministic score boost, P2 get +0.0
const PRIORITY_BOOST: Record<string, number> = {
  P1: 0.15,
  P2: 0.0,
};

// ── Leads matched to ICP segments ──────────────────────────────
const FAKE_LEADS = [
  // A: Luxury & High-Ticket Services
  { firstName: 'Ahmed', lastName: 'Al Mansoori', email: 'ahmed@oceancharters.ae', phone: '+971501234567', source: 'apollo', status: 'replied' as const, icpIndex: 0, enrichmentData: { companyName: 'Ocean Charter Dubai', industry: 'Yacht Charter', country: 'UAE', city: 'Dubai', employeeCount: 35, domain: 'oceancharters.ae', linkedinUrl: 'https://linkedin.com/in/ahmedmansoori', title: 'Managing Director', phone: '+971501234567', avgDealSize: 'AED 45,000', whatsappUsage: 'Primary sales channel', _scoreInfo: { blendedScore: 0.92, scoreBand: 'HIGH', reasoning: ['Industry perfect fit: Yacht Charter (luxury high-ticket)', 'High avg deal size (AED 45K) matches payment complexity criteria', 'WhatsApp-led sales motion confirms sales fit', 'UAE location in core market', 'Decision maker role (Managing Director)'] } } },
  { firstName: 'Diana', lastName: 'Rostova', email: 'diana@elitecars.ae', phone: '+971502345678', source: 'linkedin_scrape', status: 'messaged' as const, icpIndex: 0, enrichmentData: { companyName: 'Elite Cars Rental', industry: 'Luxury Car Rental', country: 'UAE', city: 'Dubai', employeeCount: 22, domain: 'elitecars.ae', linkedinUrl: 'https://linkedin.com/in/dianarostova', title: 'Operations Director', phone: '+971502345678', avgDealSize: 'AED 15,000', _scoreInfo: { blendedScore: 0.85, scoreBand: 'HIGH', reasoning: ['Luxury car rental is high-ticket service segment', 'International client mix likely (Dubai tourism)', 'Company size fits target range', 'Decision maker role'] } } },

  // B: Gifting, Corporate & Bespoke
  { firstName: 'Sara', lastName: 'Al Hashemi', email: 'sara@blossomgifts.ae', phone: '+971503456789', source: 'google_search', status: 'enriched' as const, icpIndex: 1, enrichmentData: { companyName: 'Blossom Premium Gifting', industry: 'Corporate Gifting', country: 'UAE', city: 'Abu Dhabi', employeeCount: 18, domain: 'blossomgifts.ae', linkedinUrl: 'https://linkedin.com/in/sarahashemi', title: 'Founder & CEO', phone: '+971503456789', whatsappUsage: 'Bulk orders via WhatsApp', seasonalPeaks: 'Ramadan, National Day, Corporate Year-End', _scoreInfo: { blendedScore: 0.88, scoreBand: 'HIGH', reasoning: ['Corporate gifting with seasonal volume spikes', 'WhatsApp-driven bulk orders confirm sales motion fit', 'Founder-led = fast decision maker', 'Multiple agents likely handling sales'] } } },

  // C: Events, Weddings & Experiential
  { firstName: 'Fatima', lastName: 'Al Zahrani', email: 'fatima@dreamweddings.ae', phone: '+971504567890', source: 'apollo', status: 'messaged' as const, icpIndex: 2, enrichmentData: { companyName: 'Dream Weddings Dubai', industry: 'Wedding Planning', country: 'UAE', city: 'Dubai', employeeCount: 12, domain: 'dreamweddings.ae', linkedinUrl: 'https://linkedin.com/in/fatimazahrani', title: 'Creative Director', phone: '+971504567890', avgDealSize: 'AED 80,000', whatsappUsage: 'Client coordination + payments', _scoreInfo: { blendedScore: 0.91, scoreBand: 'HIGH', reasoning: ['Wedding planning = very high ticket, deposit-heavy', 'Multiple stakeholders paying from different locations', 'Time-sensitive payments (zero tolerance for delays)', 'WhatsApp-led client coordination confirms sales fit', 'Revenue attribution by event needed'] } } },
  { firstName: 'Omar', lastName: 'Khalifa', email: 'omar@popupsouk.ae', phone: '+971505678901', source: 'google_search', status: 'enriched' as const, icpIndex: 2, enrichmentData: { companyName: 'PopUp Souk', industry: 'Pop-up Markets', country: 'UAE', city: 'Dubai', employeeCount: 8, domain: 'popupsouk.ae', title: 'Founder', phone: '+971505678901', avgDealSize: 'AED 5,000 per vendor', _scoreInfo: { blendedScore: 0.72, scoreBand: 'MEDIUM', reasoning: ['Pop-up market operator fits events segment', 'Multiple vendors = good fit for master dashboard', 'Smaller ticket size per transaction', 'Seasonal/event-based volume'] } } },

  // D: Home, Design & Contracting
  { firstName: 'Khalid', lastName: 'Al Dosari', email: 'khalid@alhabdesign.sa', phone: '+966552345678', source: 'apollo', status: 'enriched' as const, icpIndex: 3, enrichmentData: { companyName: 'Al Hab Interior Design', industry: 'Interior Design', country: 'KSA', city: 'Riyadh', employeeCount: 45, domain: 'alhabdesign.sa', linkedinUrl: 'https://linkedin.com/in/khaliddosari', title: 'Business Development Manager', phone: '+966552345678', avgDealSize: 'AED 120,000', paymentMethod: 'Bank transfers (current)', _scoreInfo: { blendedScore: 0.87, scoreBand: 'HIGH', reasoning: ['Interior design = milestone-based payments', 'Currently on bank transfers (high pain, switching ready)', 'KSA market is core geography', 'High average deal size fits payment complexity', 'Poor reconciliation with bank transfers is a pain point'] } } },

  // E: Boutique Hospitality
  { firstName: 'Noura', lastName: 'Al Suwaidi', email: 'noura@palmvillas.ae', phone: '+971506789012', source: 'linkedin_scrape', status: 'messaged' as const, icpIndex: 4, enrichmentData: { companyName: 'Palm Villas Collection', industry: 'Holiday Homes', country: 'UAE', city: 'Dubai', employeeCount: 28, domain: 'palmvillas.ae', linkedinUrl: 'https://linkedin.com/in/nourasuwaidi', title: 'Chief Commercial Officer', phone: '+971506789012', avgDealSize: 'AED 8,000 per booking', internationalGuests: '65%', _scoreInfo: { blendedScore: 0.84, scoreBand: 'HIGH', reasoning: ['Holiday homes with high-value bookings + deposits', '65% international guests = multi-currency need', 'Pre-arrival WhatsApp communication is key', 'Add-on services create upsell opportunity', 'CCO role = decision maker'] } } },

  // F: Premium Wellness
  { firstName: 'Layla', lastName: 'Nasser', email: 'layla@glowclinic.ae', phone: '+971507890123', source: 'google_search', status: 'new' as const, icpIndex: 5, enrichmentData: { companyName: 'Glow Aesthetics Clinic', industry: 'Aesthetic Medicine', country: 'UAE', city: 'Dubai', employeeCount: 15, domain: 'glowclinic.ae', title: 'Founder & Medical Director', phone: '+971507890123', avgDealSize: 'AED 12,000 per package', medicalTourism: true, _scoreInfo: { blendedScore: 0.79, scoreBand: 'HIGH', reasoning: ['Premium aesthetics clinic = high-ticket packages', 'Medical tourism clients need international payments', 'Deposit-based booking model fits well', 'Founder role = decision maker', 'P2 priority ICP but strong individual signals'] } } },

  // G: Coaching & Advisory
  { firstName: 'Mohammed', lastName: 'Khan', email: 'mohammed@scalemind.sa', phone: '+966551234567', source: 'apollo', status: 'replied' as const, icpIndex: 6, enrichmentData: { companyName: 'ScaleMind Advisory', industry: 'Business Advisory', country: 'KSA', city: 'Riyadh', employeeCount: 8, domain: 'scalemind.sa', linkedinUrl: 'https://linkedin.com/in/mohammedkhan', title: 'CEO', phone: '+966551234567', avgDealSize: 'AED 25,000 per retainer', whatsappUsage: 'Client acquisition + payment collection', _scoreInfo: { blendedScore: 0.76, scoreBand: 'HIGH', reasoning: ['High-ticket advisory retainers', 'WhatsApp-driven client acquisition', 'Milestone/staged payments needed', 'CEO = direct decision maker', 'KSA core market'] } } },

  // H: Education & Training
  { firstName: 'Hessa', lastName: 'Al Shamsi', email: 'hessa@techacademy.ae', phone: '+971508901234', source: 'apollo', status: 'processing' as const, icpIndex: 7, enrichmentData: { companyName: 'Tech Academy Dubai', industry: 'Professional Training', country: 'UAE', city: 'Dubai', employeeCount: 32, domain: 'techacademy.ae', linkedinUrl: 'https://linkedin.com/in/hessashamsi', title: 'Head of Growth', phone: '+971508901234', avgDealSize: 'AED 4,500 per course', cohortModel: true, _scoreInfo: { blendedScore: 0.68, scoreBand: 'MEDIUM', reasoning: ['Professional training with cohort model', 'Deposits required for seat reservation', 'Medium ticket size limits revenue potential', 'Growth role = influencer, not final decision maker', 'Good fit for promo codes and WhatsApp campaigns'] } } },

  // More varied leads
  { firstName: 'Rashed', lastName: 'Al Mubarak', email: 'rashed@gulfevents.ae', phone: '+971509012345', source: 'google_search', status: 'cold' as const, icpIndex: 2, enrichmentData: { companyName: 'Gulf Events Production', industry: 'Event Production', country: 'UAE', city: 'Abu Dhabi', employeeCount: 55, domain: 'gulfevents.ae', title: 'Operations Manager', phone: '+971509012345', _scoreInfo: { blendedScore: 0.45, scoreBand: 'LOW', reasoning: ['Event production company fits segment', 'Operations Manager is not decision maker', 'No clear WhatsApp sales motion signals', 'No international payment need indicated', 'Cold lead — no engagement'] } } },
  { firstName: 'Youssef', lastName: 'Habib', email: 'youssef@luxstay.ae', phone: '+971501112233', source: 'apollo', status: 'enriched' as const, icpIndex: 4, enrichmentData: { companyName: 'LuxStay Residences', industry: 'Serviced Residences', country: 'UAE', city: 'Dubai', employeeCount: 42, domain: 'luxstay.ae', linkedinUrl: 'https://linkedin.com/in/youssefhabib', title: 'Revenue Manager', phone: '+971501112233', avgDealSize: 'AED 6,500 per stay', internationalGuests: '70%', _scoreInfo: { blendedScore: 0.82, scoreBand: 'HIGH', reasoning: ['Serviced residences with high international guest ratio', 'Revenue Manager role shows commercial focus', 'High booking values with deposit model', 'WhatsApp pre-arrival communication standard'] } } },
  { firstName: 'Amira', lastName: 'Farouk', email: 'amira@artisanflowers.sa', phone: '+966553456789', source: 'linkedin_scrape', status: 'messaged' as const, icpIndex: 1, enrichmentData: { companyName: 'Artisan Flowers KSA', industry: 'Florists', country: 'KSA', city: 'Jeddah', employeeCount: 12, domain: 'artisanflowers.sa', linkedinUrl: 'https://linkedin.com/in/amirafarouk', title: 'Owner', phone: '+966553456789', avgDealSize: 'AED 3,500 per arrangement', seasonalPeaks: 'Valentines, Mothers Day, Ramadan', _scoreInfo: { blendedScore: 0.74, scoreBand: 'MEDIUM', reasoning: ['High-end florist with seasonal peaks', 'Owner = decision maker', 'Medium ticket size', 'KSA market in core geography', 'WhatsApp ordering likely but not confirmed'] } } },
];

const PITCHED_FEATURES = [
  'WhatsApp Payment Links', 'Catalog (CShop)', 'Multi-MID Retry', 'Promo Codes',
  'International Cards', 'Milestone Payments', 'WhatsApp Campaigns', 'Guest CRM',
];

async function main(): Promise<void> {
  // Auth handled by Supabase — createdByUserId is nullable, use null for seed data
  const seedUserId = null;

  // Upsert ICP profiles by name (safe for re-runs — no cascade deletion)
  console.log('Upserting 8 ICP segments from PDF...');

  const icpIds: string[] = [];
  for (const segment of ICP_SEGMENTS) {
    const priority = (segment.metadataJson as { priority: string }).priority;
    const priorityBoost = PRIORITY_BOOST[priority] ?? 0;

    const icpData = {
      description: segment.description,
      qualificationLogic: 'WEIGHTED' as const,
      targetIndustries: segment.targetIndustries,
      targetCountries: segment.targetCountries,
      minCompanySize: segment.minCompanySize,
      maxCompanySize: segment.maxCompanySize,
      requiredTechnologies: [] as string[],
      excludedDomains: [] as string[],
      featureList: JSON.parse(JSON.stringify(segment.featureList)),
      metadataJson: JSON.parse(JSON.stringify({
        ...segment.metadataJson,
        priorityBoost,
      })),
      isActive: true,
      createdByUserId: seedUserId,
    };

    const icp = await prisma.icpProfile.upsert({
      where: { name: segment.name },
      create: { name: segment.name, ...icpData },
      update: icpData,
    });
    icpIds.push(icp.id);

    // Replace qualification rules for this ICP (safe — only deletes rules for THIS ICP)
    await prisma.qualificationRule.deleteMany({ where: { icpProfileId: icp.id } });
    for (const rule of segment.rules) {
      await prisma.qualificationRule.create({
        data: {
          icpProfileId: icp.id,
          name: rule.name,
          ruleType: rule.isRequired ? 'HARD_FILTER' : 'WEIGHTED',
          isRequired: rule.isRequired,
          fieldKey: rule.fieldKey,
          operator: rule.operator,
          valueJson: rule.expectedValue as never,
          weight: rule.isRequired ? null : rule.weight,
          orderIndex: rule.orderIndex,
          priority: rule.orderIndex,
          isActive: true,
        },
      });
    }

    console.log(`  Upserted ICP "${segment.name}" with ${segment.rules.length} qualification rules (priority boost: +${priorityBoost})`);
  }

  // Seed leads
  console.log('Seeding leads...');
  for (const leadData of FAKE_LEADS) {
    const lead = await prisma.lead.upsert({
      where: { email: leadData.email },
      update: {
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        phone: leadData.phone,
        source: leadData.source,
        status: leadData.status,
        enrichmentData: JSON.parse(JSON.stringify(leadData.enrichmentData)),
      },
      create: {
        firstName: leadData.firstName,
        lastName: leadData.lastName,
        email: leadData.email,
        phone: leadData.phone,
        source: leadData.source,
        status: leadData.status,
        enrichmentData: JSON.parse(JSON.stringify(leadData.enrichmentData)),
      },
    });

    const icpId = icpIds[leadData.icpIndex] ?? icpIds[0]!;
    const pitchedFeature = PITCHED_FEATURES[Math.floor(Math.random() * PITCHED_FEATURES.length)]!;

    // Map lead source to DiscoveryProvider enum
    const SOURCE_TO_PROVIDER: Record<string, string> = {
      apollo: 'APOLLO',
      linkedin_scrape: 'LINKEDIN_SCRAPE',
      google_search: 'GOOGLE_SEARCH',
      google_places: 'GOOGLE_PLACES',
      brave_search: 'BRAVE_SEARCH',
      company_search_free: 'COMPANY_SEARCH_FREE',
    };
    const discoveryProvider = SOURCE_TO_PROVIDER[leadData.source] ?? 'APOLLO';

    // Create discovery record so the funnel API counts this lead
    const existingDiscovery = await prisma.leadDiscoveryRecord.findFirst({ where: { leadId: lead.id, icpProfileId: icpId } });
    if (!existingDiscovery) {
      await prisma.leadDiscoveryRecord.create({
        data: {
          leadId: lead.id,
          icpProfileId: icpId,
          provider: discoveryProvider as 'APOLLO',
          providerRecordId: `seed-${lead.id}`,
          queryHash: `seed-query-${leadData.icpIndex}`,
          status: 'DISCOVERED',
          rawPayload: JSON.parse(JSON.stringify(leadData.enrichmentData)),
          discoveredAt: lead.createdAt,
        },
      });
    }

    // Create enrichment record so the API relation-based query returns enrichment data
    const existingEnrichment = await prisma.leadEnrichmentRecord.findFirst({ where: { leadId: lead.id } });
    if (!existingEnrichment) {
      const { _scoreInfo, ...enrichmentPayload } = leadData.enrichmentData as Record<string, unknown>;
      await prisma.leadEnrichmentRecord.create({
        data: {
          leadId: lead.id,
          provider: 'HUNTER',
          status: 'COMPLETED',
          normalizedPayload: JSON.parse(JSON.stringify(enrichmentPayload)),
          rawPayload: JSON.parse(JSON.stringify(leadData.enrichmentData)),
          enrichedAt: new Date(),
          requestKey: `seed-enrich-${lead.id}`,
        },
      });
    }

    // Create message drafts for messaged/replied/enriched leads
    if (leadData.status === 'messaged' || leadData.status === 'replied' || leadData.status === 'enriched') {
      const existingDraft = await prisma.messageDraft.findFirst({ where: { leadId: lead.id } });

      if (!existingDraft) {
        const approvalStatus = leadData.status === 'enriched' ? 'PENDING' as const : 'APPROVED' as const;
        const draft = await prisma.messageDraft.create({
          data: {
            leadId: lead.id,
            icpProfileId: icpId,
            promptVersion: 'v1.0',
            generatedByModel: 'gpt-4o-mini',
            approvalStatus,
            ...(approvalStatus === 'APPROVED' ? { approvedByUserId: seedUserId, approvedAt: new Date() } : {}),
            followUpNumber: 0,
            pitchedFeature,
          },
        });

        const company = leadData.enrichmentData.companyName;
        // Alternate between WhatsApp and Email — one channel per draft
        const useWhatsApp = leadData.enrichmentData.whatsappUsage !== undefined;
        const channel = useWhatsApp ? 'WHATSAPP' as const : 'EMAIL' as const;

        const variant = await prisma.messageVariant.create({
          data: {
            messageDraftId: draft.id,
            variantKey: 'A',
            channel,
            subject: channel === 'EMAIL' ? `${leadData.firstName}, quick question about ${company}'s payment flow` : null,
            bodyText: channel === 'WHATSAPP'
              ? `Hi ${leadData.firstName}! I'm from Zbooni — we help businesses like ${company} collect payments directly through WhatsApp conversations. Would love to show you how it works. Free for a quick chat?`
              : `Hi ${leadData.firstName},\n\nI noticed ${company} is doing great work in ${leadData.enrichmentData.industry}. We help businesses like yours collect payments faster through WhatsApp — branded links, instant confirmations, and multi-currency support.\n\nWould you be open to a 15-minute call this week?\n\nBest,\nZbooni Sales Team`,
            bodyHtml: null,
            ctaText: channel === 'EMAIL' ? 'Book a Demo' : null,
            qualityScore: 0.78 + Math.random() * 0.15,
            isSelected: approvalStatus === 'APPROVED',
          },
        });

        // Create sends for approved drafts
        if (approvalStatus === 'APPROVED') {
          await prisma.messageSend.create({
            data: {
              leadId: lead.id,
              messageDraftId: draft.id,
              messageVariantId: variant.id,
              channel,
              provider: channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
              status: leadData.status === 'replied' ? 'REPLIED' : 'SENT',
              idempotencyKey: `seed-${lead.id}-${Date.now()}`,
              sentAt: new Date(Date.now() - 86400000 * (2 + Math.floor(Math.random() * 5))),
              ...(leadData.status === 'replied' ? { repliedAt: new Date(Date.now() - 86400000) } : {}),
            },
          });
        }
      }
    }
  }

  // Seed auto-approve pipeline settings defaults
  const autoApproveDefaults = [
    { key: 'auto_approve_enabled', valueJson: false },
    { key: 'auto_approve_score_min', valueJson: 0 },
    { key: 'auto_approve_score_max', valueJson: 1 },
  ];
  for (const setting of autoApproveDefaults) {
    await prisma.pipelineSetting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, valueJson: setting.valueJson },
      update: {},
    });
  }
  console.log('Seeded 3 auto-approve pipeline settings');

  console.log(`Seeded ${ICP_SEGMENTS.length} ICPs with qualification rules, ${FAKE_LEADS.length} leads, and message drafts.`);
  console.log('Priority boost: P1 segments +0.15, P2 segments +0.0');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
