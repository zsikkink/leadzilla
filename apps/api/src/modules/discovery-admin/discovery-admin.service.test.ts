import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listDiscoveryPhase1AssignmentLocationSummariesMock } = vi.hoisted(() => ({
  listDiscoveryPhase1AssignmentLocationSummariesMock: vi.fn(),
}));

vi.mock('@lead-flood/db', () => ({
  listDiscoveryPhase1AssignmentLocationSummaries: listDiscoveryPhase1AssignmentLocationSummariesMock,
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
