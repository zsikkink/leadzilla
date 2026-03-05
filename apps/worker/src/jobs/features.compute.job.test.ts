import { describe, expect, it } from 'vitest';

import {
  computeFeatureVectorHash,
  FEATURE_KEYS,
  stableStringify,
  toEmployeeSizeBucket,
} from './features.compute.job.js';

describe('features.compute helpers', () => {
  it('stableStringify keeps deterministic object order', () => {
    const first = stableStringify({
      b: 2,
      a: 1,
      nested: {
        z: true,
        x: false,
      },
    });

    const second = stableStringify({
      nested: {
        x: false,
        z: true,
      },
      a: 1,
      b: 2,
    });

    expect(first).toBe(second);
  });

  it('computeFeatureVectorHash is stable across key order variations', () => {
    const firstHash = computeFeatureVectorHash({
      source_provider: 'BRAVE_SEARCH',
      has_email: true,
      has_domain: true,
    });
    const secondHash = computeFeatureVectorHash({
      has_domain: true,
      has_email: true,
      source_provider: 'BRAVE_SEARCH',
    });

    expect(firstHash).toBe(secondHash);
  });

  it('maps employee size bucket consistently', () => {
    expect(toEmployeeSizeBucket(null)).toBe('unknown');
    expect(toEmployeeSizeBucket(5)).toBe('micro');
    expect(toEmployeeSizeBucket(20)).toBe('small');
    expect(toEmployeeSizeBucket(100)).toBe('medium');
    expect(toEmployeeSizeBucket(600)).toBe('large');
    expect(toEmployeeSizeBucket(5000)).toBe('enterprise');
  });

  it('exposes the required feature keys (67 total)', () => {
    expect(FEATURE_KEYS).toEqual([
      'source_provider',
      'has_email',
      'has_domain',
      'has_company_name',
      'country',
      'industry',
      'industry_supported',
      'has_whatsapp',
      'has_instagram',
      'accepts_online_payments',
      'review_count',
      'follower_count',
      'physical_address_present',
      'recent_activity',
      'custom_order_signals',
      'pure_self_serve_ecom',
      'shopify_detected',
      'multi_staff_detected',
      'follower_growth_signal',
      'high_engagement_signal',
      'has_booking_or_contact_form',
      'variable_pricing_detected',
      'industry_match',
      'industry_match_reason',
      'geo_match',
      'geo_match_reason',
      'employee_size_bucket',
      'high_ticket_signals',
      'deposit_milestone_signals',
      'subscription_billing_detected',
      'international_customer_signals',
      'icp_segment_priority',
      'review_count_tier',
      'follower_count_tier',
      'seasonal_signals',
      'bank_transfer_reliance',
      'upsell_signals',
      'price_led_mindset',
      // v2 features
      'apify_payment_widget_count',
      'apify_has_shopify',
      'apify_has_booking_form',
      'apify_has_pricing_tiers',
      'apify_has_product_catalog',
      'apify_platform',
      'instagram_follower_count',
      'instagram_engagement_rate',
      'instagram_is_business_account',
      'instagram_days_since_last_post',
      'instagram_has_bio_link',
      'has_decision_maker_phone',
      'decision_maker_seniority',
      'contact_source',
      // v2.1 features (enhanced scrapers)
      'decision_maker_count',
      'apollo_has_direct_phone',
      'website_email_count',
      'website_phone_count',
      'social_link_count',
      'has_linkedin',
      'tech_stack_size',
      'has_crm',
      'has_live_chat',
      'has_analytics',
      'estimated_employees',
      'certification_count',
      'instagram_business_category',
      'instagram_has_business_email',
      // v2.2 data quality
      'data_alignment_score',
    ]);
    expect(FEATURE_KEYS.length).toBe(67);
  });
});
