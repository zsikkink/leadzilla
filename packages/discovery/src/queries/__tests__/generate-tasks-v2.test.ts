import { describe, expect, it } from 'vitest';

import {
  queryTemplatesV2AR,
  queryTemplatesV2EN,
  queryTemplatesV2SerpApiAR,
  queryTemplatesV2SerpApiEN,
  serpApiSearchCitiesByCountry,
} from '../seeds.js';
import type { GenerateTasksV2Input } from '../generate_tasks.js';
import { generateTasksV2 } from '../generate_tasks.js';

const fixedDate = new Date('2026-02-26T12:00:00.000Z');

describe('generateTasksV2', () => {
  it('generates correct number of tasks for given inputs', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery', 'gym'],
      countries: ['AE'],
      cities: ['Dubai'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // 1 country × 1 city × 2 categories × 1 template × 1 page × 1 taskType = 2
    const expectedCount = 1 * 1 * input.categories.length * queryTemplatesV2EN.length * 1 * 1;
    expect(tasks.length).toBe(expectedCount);
    expect(expectedCount).toBe(2);
  });

  it('uses default cities when cities is omitted', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['QA'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // QA uses the SerpAPI-safe defaults instead of legacy broad defaults.
    const defaultCities = serpApiSearchCitiesByCountry['QA']!;
    expect(defaultCities).toEqual(expect.arrayContaining(['Doha', 'Al Wakrah', 'Al Khor']));
    expect(tasks.length).toBe(defaultCities.length * 1 * queryTemplatesV2EN.length * 1 * 1);

    const taskCities = new Set(tasks.map((task) => task.city));
    expect(taskCities).toEqual(new Set(defaultCities));
  });

  it('expands "All" to default cities for each country', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['All'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // AE uses the SerpAPI-safe default set, not legacy broad defaults.
    const aeCities = serpApiSearchCitiesByCountry['AE']!;
    expect(aeCities).toEqual(expect.arrayContaining(['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain']));
    expect(aeCities.length).toBeGreaterThanOrEqual(10);

    const expectedCount = aeCities.length * 1 * queryTemplatesV2EN.length * 1 * 1;
    expect(tasks.length).toBe(expectedCount);

    // Verify all default cities are present
    const taskCities = new Set(tasks.map((t) => t.city));
    for (const city of aeCities) {
      expect(taskCities.has(city)).toBe(true);
    }
  });

  it('filters explicit cities to SerpAPI-supported search locations for launch countries', () => {
    const input: GenerateTasksV2Input = {
      categories: ['beauty salon'],
      countries: ['EG', 'JO', 'SA'],
      cities: ['not-serpapi-location', 'Abu Kabir', 'Riyadh'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });
    const taskCities = new Set(tasks.map((task) => task.city));

    expect(taskCities).toEqual(new Set(['Abu Kabir', 'Riyadh']));
  });

  it('does not fall back to broad defaults for countries without a SerpAPI allowlist', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['DE'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    expect(tasks).toHaveLength(0);
  });

  it('does not pass explicit cities through for countries without a SerpAPI allowlist', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['DE'],
      cities: ['Berlin'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    expect(tasks).toHaveLength(0);
  });

  it('uses custom cities when provided', () => {
    const input: GenerateTasksV2Input = {
      categories: ['gym'],
      countries: ['SA'],
      cities: ['Riyadh', 'Jeddah'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // 1 country × 2 cities × 1 category × 1 template × 1 page × 1 taskType = 2
    expect(tasks.length).toBe(2);

    const taskCities = new Set(tasks.map((t) => t.city));
    expect(taskCities).toEqual(new Set(['Riyadh', 'Jeddah']));
  });

  it('generates English and Arabic queries when both languages are requested', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
      languages: ['en', 'ar'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    expect(tasks).toHaveLength(queryTemplatesV2EN.length + queryTemplatesV2AR.length);
    expect(new Set(tasks.map((task) => task.language))).toEqual(new Set(['en', 'ar']));
    expect(tasks.map((task) => task.queryText)).toEqual(
      expect.arrayContaining(['bakery in Dubai', 'bakery في Dubai']),
    );
  });

  it('uses contact-signal query templates for SerpAPI-backed English and Arabic runs', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
      languages: ['en', 'ar'],
      searchProvider: 'SERPAPI',
      taskTypes: ['SERP_MAPS_LOCAL'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    expect(tasks).toHaveLength(queryTemplatesV2SerpApiEN.length + queryTemplatesV2SerpApiAR.length);
    expect(tasks.map((task) => task.queryText)).toEqual(
      expect.arrayContaining([
        'bakery in Dubai official website',
        'bakery in Dubai whatsapp',
        'bakery in Dubai instagram',
        'bakery في Dubai الموقع الرسمي',
        'bakery في Dubai واتساب',
        'bakery في Dubai انستقرام',
      ]),
    );
    expect(new Set(tasks.map((task) => task.paramsJson.engine))).toEqual(new Set(['google_maps']));
  });

  it('defaults to SERP_MAPS_LOCAL task type only', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    const taskTypes = new Set(tasks.map((t) => t.taskType));
    expect(taskTypes).toEqual(new Set(['SERP_MAPS_LOCAL']));
  });

  it('uses custom task types when provided', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
      taskTypes: ['SERP_GOOGLE'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // 1 country × 1 city × 1 category × 1 template × 1 page × 1 taskType = 1
    expect(tasks.length).toBe(1);
    for (const task of tasks) {
      expect(task.taskType).toBe('SERP_GOOGLE');
    }
  });

  it('respects maxPagesPerQuery', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
      maxPagesPerQuery: 3,
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // 1 country × 1 city × 1 category × 1 template × 3 pages × 1 taskType = 3
    expect(tasks.length).toBe(3);

    const pages = new Set(tasks.map((t) => t.page));
    expect(pages).toEqual(new Set([1, 2, 3]));
  });

  it('uses Google Maps pagination offsets for maps-local tasks', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
      maxPagesPerQuery: 2,
      taskTypes: ['SERP_MAPS_LOCAL'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });
    const pageTwoTask = tasks.find((task) => task.page === 2);

    expect(pageTwoTask?.paramsJson.start).toBe(20);
  });

  it('does not include country name in query text', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    const firstTask = tasks[0]!;
    expect(firstTask.queryText).not.toContain('United Arab Emirates');
    expect(firstTask.queryText).toContain('Dubai');
    expect(firstTask.queryText).toContain('bakery');
  });

  it('does not generate tasks for invalid countries', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['XX'],
      cities: ['TestCity'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });
    expect(tasks).toHaveLength(0);
  });

  it('includes v2 in the timeBucket', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['Dubai'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    for (const task of tasks) {
      expect(task.timeBucket).toContain(':v2');
    }
  });

  it('generates unique ids for all tasks', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery', 'gym'],
      countries: ['AE', 'SA'],
      cities: ['Dubai', 'Riyadh'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });
    const ids = new Set(tasks.map((t) => t.id));
    expect(ids.size).toBe(tasks.length);
  });
});
