import { describe, expect, it } from 'vitest';

import { categoryTaxonomyEN } from '../seeds.js';
import {
  ICP_INDUSTRY_CATEGORY_MAP,
  mapIcpIndustriesToCategories,
} from '../icp-category-map.js';

describe('mapIcpIndustriesToCategories', () => {
  it('returns full taxonomy when given an empty array', () => {
    const result = mapIcpIndustriesToCategories([]);
    expect(result).toEqual(categoryTaxonomyEN);
  });

  it('maps a known industry to its categories', () => {
    const result = mapIcpIndustriesToCategories(['luxury_retail']);
    expect(result).toEqual(ICP_INDUSTRY_CATEGORY_MAP['luxury_retail']);
  });

  it('maps food_beverage to expected categories', () => {
    const result = mapIcpIndustriesToCategories(['food_beverage']);
    expect(result).toContain('restaurant');
    expect(result).toContain('coffee shop');
    expect(result).toContain('bakery');
    expect(result).toContain('catering service');
  });

  it('deduplicates across multiple industries sharing a category', () => {
    // Both food_beverage and events include 'catering service'
    const result = mapIcpIndustriesToCategories(['food_beverage', 'events']);
    const cateringCount = result.filter((c) => c === 'catering service').length;
    expect(cateringCount).toBe(1);
  });

  it('combines categories from multiple known industries', () => {
    const result = mapIcpIndustriesToCategories(['fitness', 'pets']);
    expect(result).toContain('gym');
    expect(result).toContain('fitness center');
    expect(result).toContain('pet shop');
    expect(result).toContain('veterinary clinic');
  });

  it('returns empty array for a completely unknown industry', () => {
    const result = mapIcpIndustriesToCategories(['quantum_computing']);
    expect(result).toEqual([]);
  });

  it('fuzzy-matches an unknown industry against the taxonomy', () => {
    // "pet" is a token that matches "pet shop" in the taxonomy
    const result = mapIcpIndustriesToCategories(['pet_care']);
    expect(result).toContain('pet shop');
  });

  it('is case-insensitive for industry keys', () => {
    const result = mapIcpIndustriesToCategories(['LUXURY_RETAIL']);
    expect(result).toEqual(ICP_INDUSTRY_CATEGORY_MAP['luxury_retail']);
  });

  it('handles mixed known and unknown industries', () => {
    const result = mapIcpIndustriesToCategories(['fitness', 'unknown_xyz']);
    // Should include fitness categories, unknown_xyz contributes nothing
    expect(result).toContain('gym');
    expect(result.length).toBe(ICP_INDUSTRY_CATEGORY_MAP['fitness']!.length);
  });
});
