import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listDiscoveryPhase1AssignmentLocationSummariesMock,
  listDiscoveryPhase1HistoricalSearchInputCohortAssignmentsMock,
  listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock,
} = vi.hoisted(() => ({
  listDiscoveryPhase1AssignmentLocationSummariesMock: vi.fn(),
  listDiscoveryPhase1HistoricalSearchInputCohortAssignmentsMock: vi.fn(),
  listDiscoveryPhase1HistoricalSearchInputCohortSummariesMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  listDiscoveryPhase1AssignmentLocationSummaries: listDiscoveryPhase1AssignmentLocationSummariesMock,
  listDiscoveryPhase1HistoricalSearchInputCohortAssignments:
    listDiscoveryPhase1HistoricalSearchInputCohortAssignmentsMock,
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

describe('buildDiscoveryAdminService.getDiscoveryPhase1HistoricalSearchInputCohortAssignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the historical cohort assignment helper with the selected durable cohort keys and maps the underlying assignment rows', async () => {
    listDiscoveryPhase1HistoricalSearchInputCohortAssignmentsMock.mockResolvedValue([
      {
        assignment_id: 'assignment_1',
        discovery_run_id: 'run_alpha',
        assigned_at: new Date('2026-03-01T01:00:00.000Z'),
        icp_profile_id: 'icp_1',
        business_id: 'business_1',
        search_task_id: 'task_1',
        primary_outcome_code: 'LEAD_CREATED',
        phase1_class: 'PHASE1_POSITIVE',
        exclusion_reason: null,
        task_type: 'SERP_GOOGLE',
        country_code: 'AE',
        city: 'Dubai',
        language: 'en',
        query_text: 'dentist dubai',
        normalized_query_key: 'dentist dubai',
        query_hash: 'query_hash_1',
        page: 1,
        time_bucket: 'weekday_morning',
      },
      {
        assignment_id: 'assignment_2',
        discovery_run_id: 'run_beta',
        assigned_at: new Date('2026-03-01T02:00:00.000Z'),
        icp_profile_id: 'icp_1',
        business_id: 'business_2',
        search_task_id: 'task_2',
        primary_outcome_code: null,
        phase1_class: 'EXCLUDE_INCOMPLETE',
        exclusion_reason: 'NULL_PRIMARY_NO_DURABLE_PHASE1_STATE',
        task_type: 'SERP_GOOGLE',
        country_code: 'AE',
        city: 'Dubai',
        language: 'en',
        query_text: 'dentist dubai near me',
        normalized_query_key: 'dentist dubai',
        query_hash: 'query_hash_1',
        page: 1,
        time_bucket: 'weekday_morning',
      },
    ]);

    const adminService = buildDiscoveryAdminService(
      buildDiscoveryAdminRepositoryMock(),
      {},
    );

    const response = await adminService.getDiscoveryPhase1HistoricalSearchInputCohortAssignments({
      assignedAtStart: '2026-03-01T00:00:00.000Z',
      assignedAtEnd: '2026-03-02T00:00:00.000Z',
      icpProfileId: 'icp_1',
      taskType: 'SERP_GOOGLE',
      countryCode: 'AE',
      city: 'Dubai',
      language: 'en',
      normalizedQueryKey: 'dentist dubai',
      queryHash: 'query_hash_1',
      page: 1,
      timeBucket: 'weekday_morning',
    });

    expect(listDiscoveryPhase1HistoricalSearchInputCohortAssignmentsMock).toHaveBeenCalledWith({
      assignedAtStart: new Date('2026-03-01T00:00:00.000Z'),
      assignedAtEnd: new Date('2026-03-02T00:00:00.000Z'),
      icpProfileId: 'icp_1',
      taskType: 'SERP_GOOGLE',
      countryCode: 'AE',
      city: 'Dubai',
      language: 'en',
      normalizedQueryKey: 'dentist dubai',
      queryHash: 'query_hash_1',
      page: 1,
      timeBucket: 'weekday_morning',
    });
    expect(response).toEqual({
      searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
      assignments: [
        {
          assignmentId: 'assignment_1',
          discoveryRunId: 'run_alpha',
          assignedAt: '2026-03-01T01:00:00.000Z',
          icpProfileId: 'icp_1',
          businessId: 'business_1',
          searchTaskId: 'task_1',
          primaryOutcomeCode: 'LEAD_CREATED',
          phase1Class: 'PHASE1_POSITIVE',
          exclusionReason: null,
          taskType: 'SERP_GOOGLE',
          countryCode: 'AE',
          city: 'Dubai',
          language: 'en',
          queryText: 'dentist dubai',
          normalizedQueryKey: 'dentist dubai',
          queryHash: 'query_hash_1',
          page: 1,
          timeBucket: 'weekday_morning',
        },
        {
          assignmentId: 'assignment_2',
          discoveryRunId: 'run_beta',
          assignedAt: '2026-03-01T02:00:00.000Z',
          icpProfileId: 'icp_1',
          businessId: 'business_2',
          searchTaskId: 'task_2',
          primaryOutcomeCode: null,
          phase1Class: 'EXCLUDE_INCOMPLETE',
          exclusionReason: 'NULL_PRIMARY_NO_DURABLE_PHASE1_STATE',
          taskType: 'SERP_GOOGLE',
          countryCode: 'AE',
          city: 'Dubai',
          language: 'en',
          queryText: 'dentist dubai near me',
          normalizedQueryKey: 'dentist dubai',
          queryHash: 'query_hash_1',
          page: 1,
          timeBucket: 'weekday_morning',
        },
      ],
    });
  });
});
