import { describe, expect, it } from 'vitest';

import { defaultCitiesByCountry, queryTemplatesV2EN } from '../seeds.js';
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
    const expectedCount =
      1 * 1 * input.categories.length * queryTemplatesV2EN.length * 1 * 1;
    expect(tasks.length).toBe(expectedCount);
    expect(expectedCount).toBe(2);
  });

  it('uses default cities when cities is omitted', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['QA'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // QA has 1 default city (Doha)
    // 1 country × 1 city × 1 category × 1 template × 1 page × 1 taskType = 1
    const defaultCities = defaultCitiesByCountry['QA']!;
    expect(defaultCities).toEqual(['Doha']);
    expect(tasks.length).toBe(defaultCities.length * 1 * queryTemplatesV2EN.length * 1 * 1);

    // All tasks should reference Doha
    for (const task of tasks) {
      expect(task.city).toBe('Doha');
    }
  });

  it('expands "All" to default cities for each country', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['AE'],
      cities: ['All'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    // AE has 4 default cities
    const aeCities = defaultCitiesByCountry['AE']!;
    expect(aeCities.length).toBe(4);

    const expectedCount =
      aeCities.length * 1 * queryTemplatesV2EN.length * 1 * 1;
    expect(tasks.length).toBe(expectedCount);

    // Verify all default cities are present
    const taskCities = new Set(tasks.map((t) => t.city));
    for (const city of aeCities) {
      expect(taskCities.has(city)).toBe(true);
    }
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

  it('does not include unknown country code in query text', () => {
    const input: GenerateTasksV2Input = {
      categories: ['bakery'],
      countries: ['XX'],
      cities: ['TestCity'],
    };

    const tasks = generateTasksV2(input, { now: fixedDate });

    const firstTask = tasks[0]!;
    expect(firstTask.queryText).not.toContain('XX');
    expect(firstTask.queryText).toContain('TestCity');
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
