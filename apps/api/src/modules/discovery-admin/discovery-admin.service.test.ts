import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listDiscoveryPhase1AssignmentLocationSummariesMock,
  listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock,
} = vi.hoisted(() => ({
  listDiscoveryPhase1AssignmentLocationSummariesMock: vi.fn(),
  listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  listDiscoveryPhase1AssignmentLocationSummaries: listDiscoveryPhase1AssignmentLocationSummariesMock,
  listDiscoveryPhase1HistoricalSearchInputCohortSummaries:
    listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock,
}));

import { buildDiscoveryAdminService } from './discovery-admin.service.js';
import type { DiscoveryAdminRepository } from './discovery-admin.repository.js';

function buildDiscoveryAdminRepositoryMock(): DiscoveryAdminRepository {
  return {
    listBusinesses: vi.fn(),
    getBusinessById: vi.fn(),
    listLeads: vi.fn(),
    getLeadById: vi.fn(),
    listSearchTasks: vi.fn(),
    getSearchTaskById: vi.fn(),
    listJobRequests: vi.fn(),
    listStaleMessageSends: vi.fn(),
    resolveMessageSend: vi.fn(),
    listStaleApolloRevealAttempts: vi.fn(),
    resolveApolloRevealAttempt: vi.fn(),
    listJobRuns: vi.fn(),
    getJobRunById: vi.fn(),
    cancelDiscoveryRun: vi.fn(),
    approveContactRecoveryItem: vi.fn(),
    getDiscoveryRunDetail: vi.fn(),
  };
}

describe('buildDiscoveryAdminService.getDiscoveryPhase1IcpLocationSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the existing phase-1 location cohort counts into explicit measured denominators and rates', async () => {
    listDiscoveryPhase1AssignmentLocationSummariesMock.mockResolvedValue([
      {
        icp_profile_id: 'icp_1',
        country_code: 'AE',
        city: 'Dubai',
        assignment_count: 5,
        phase1_positive_count: 2,
        phase1_negative_count: 1,
        holdout_ambiguous_count: 1,
        exclude_operational_count: 1,
        exclude_incomplete_count: 0,
      },
      {
        icp_profile_id: 'icp_2',
        country_code: 'US',
        city: null,
        assignment_count: 2,
        phase1_positive_count: 0,
        phase1_negative_count: 0,
        holdout_ambiguous_count: 0,
        exclude_operational_count: 0,
        exclude_incomplete_count: 2,
      },
    ]);

    const adminService = buildDiscoveryAdminService(
      buildDiscoveryAdminRepositoryMock(),
      {},
    );

    const response = await adminService.getDiscoveryPhase1IcpLocationSummary({
      runIds: ['run_1', 'run_2'],
    });

    expect(listDiscoveryPhase1AssignmentLocationSummariesMock).toHaveBeenCalledWith([
      'run_1',
      'run_2',
    ]);
    expect(response).toEqual({
      locationBasis: 'ASSIGNED_SEARCH_TASK_LOCATION',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          countryCode: 'AE',
          city: 'Dubai',
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          holdoutAmbiguousCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 0,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
        {
          icpProfileId: 'icp_2',
          countryCode: 'US',
          city: null,
          assignmentCount: 2,
          measuredAssignmentCount: 0,
          phase1PositiveCount: 0,
          phase1NegativeCount: 0,
          holdoutAmbiguousCount: 0,
          excludeOperationalCount: 0,
          excludeIncompleteCount: 2,
          measurementCoverageRate: 0,
          phase1PositiveRateAmongMeasuredAssignments: null,
        },
      ],
    });
  });
});

describe('buildDiscoveryAdminService.getDiscoveryPhase1HistoricalSearchInputCohortSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the historical search-input cohort helper and maps stable cohort keys, run counts, and measured rates', async () => {
    listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock.mockResolvedValue([
      {
        icp_profile_id: 'icp_1',
        task_type: 'SERP_GOOGLE',
        country_code: 'AE',
        city: 'Dubai',
        language: 'en',
        normalized_query_key: 'dentist dubai',
        query_hash: 'query_hash_1',
        page: 1,
        time_bucket: 'weekday_morning',
        discovery_run_count: 2,
        assignment_count: 5,
        phase1_positive_count: 2,
        phase1_negative_count: 1,
        exclude_operational_count: 1,
        exclude_incomplete_count: 1,
      },
      {
        icp_profile_id: 'icp_2',
        task_type: 'SERP_GOOGLE_LOCAL',
        country_code: 'US',
        city: null,
        language: 'en',
        normalized_query_key: 'dentist austin',
        query_hash: 'query_hash_2',
        page: 2,
        time_bucket: 'weekend_evening',
        discovery_run_count: 1,
        assignment_count: 2,
        phase1_positive_count: 0,
        phase1_negative_count: 0,
        exclude_operational_count: 1,
        exclude_incomplete_count: 1,
      },
    ]);

    const adminService = buildDiscoveryAdminService(
      buildDiscoveryAdminRepositoryMock(),
      {},
    );

    const response = await adminService.getDiscoveryPhase1HistoricalSearchInputCohortSummaries({
      assignedAtStart: '2026-03-01T00:00:00.000Z',
      assignedAtEnd: '2026-03-02T00:00:00.000Z',
    });

    expect(listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock).toHaveBeenCalledWith({
      assignedAtStart: new Date('2026-03-01T00:00:00.000Z'),
      assignedAtEnd: new Date('2026-03-02T00:00:00.000Z'),
    });
    expect(response).toEqual({
      searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          taskType: 'SERP_GOOGLE',
          countryCode: 'AE',
          city: 'Dubai',
          language: 'en',
          normalizedQueryKey: 'dentist dubai',
          queryHash: 'query_hash_1',
          page: 1,
          timeBucket: 'weekday_morning',
          discoveryRunCount: 2,
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 1,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
        {
          icpProfileId: 'icp_2',
          taskType: 'SERP_GOOGLE_LOCAL',
          countryCode: 'US',
          city: null,
          language: 'en',
          normalizedQueryKey: 'dentist austin',
          queryHash: 'query_hash_2',
          page: 2,
          timeBucket: 'weekend_evening',
          discoveryRunCount: 1,
          assignmentCount: 2,
          measuredAssignmentCount: 0,
          phase1PositiveCount: 0,
          phase1NegativeCount: 0,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 1,
          measurementCoverageRate: 0,
          phase1PositiveRateAmongMeasuredAssignments: null,
        },
      ],
    });
  });
});
