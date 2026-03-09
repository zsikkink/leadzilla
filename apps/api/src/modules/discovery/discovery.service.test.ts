import { describe, expect, it, vi } from 'vitest';

import { DiscoveryWorkerUnavailableError } from './discovery.errors.js';
import { buildDiscoveryService } from './discovery.service.js';
import type { DiscoveryRepository } from './discovery.repository.js';

function buildRepositoryMock(): DiscoveryRepository {
  return {
    assertDiscoveryWorkerAvailable: vi.fn(async () => undefined),
    createDiscoveryRun: vi.fn(async () => undefined),
    markDiscoveryRunFailed: vi.fn(async () => undefined),
    getDiscoveryRunStatus: vi.fn(),
    listDiscoveryRecords: vi.fn(),
    listDiscoveryRuns: vi.fn(),
  };
}

describe('buildDiscoveryService', () => {
  it('fails fast when the discovery worker heartbeat is missing', async () => {
    const repository = buildRepositoryMock();
    const enqueueDiscoveryRun = vi.fn(async () => undefined);
    vi.mocked(repository.assertDiscoveryWorkerAvailable).mockRejectedValue(
      new DiscoveryWorkerUnavailableError(),
    );

    const service = buildDiscoveryService(repository, {
      enqueueDiscoveryRun,
    });

    await expect(
      service.createDiscoveryRun({
        icpProfileId: 'icp_1',
        countries: ['AE'],
        includeWebsiteAnalysis: true,
        includeSocialMediaAnalysis: true,
        limit: 10,
        requestedByUserId: 'user_1',
      }),
    ).rejects.toThrow(DiscoveryWorkerUnavailableError);

    expect(repository.createDiscoveryRun).not.toHaveBeenCalled();
    expect(enqueueDiscoveryRun).not.toHaveBeenCalled();
  });
});
