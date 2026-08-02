import { prisma } from '@lead-flood/db';
import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it } from 'vitest';

const DEMO_ICP_NAMES = [
  'Product-Led B2B SaaS Growth',
  'Mid-Market GTM Teams',
  'Vertical SaaS Operators',
  'Enterprise Workflow & Data Platforms',
] as const;

const EXPECTED_RULE_COUNTS: Record<(typeof DEMO_ICP_NAMES)[number], number> = {
  'Product-Led B2B SaaS Growth': 7,
  'Mid-Market GTM Teams': 8,
  'Vertical SaaS Operators': 8,
  'Enterprise Workflow & Data Platforms': 8,
};

function runSeedScript(): void {
  execSync('pnpm --filter @lead-flood/worker exec tsx ../../scripts/icp/seed-zbooni-icps.ts', {
    cwd: process.cwd(),
    stdio: 'pipe',
    env: process.env,
  });
}

async function cleanupSeededIcps(): Promise<void> {
  const profiles = await prisma.icpProfile.findMany({
    where: {
      name: {
        in: DEMO_ICP_NAMES,
      },
    },
    select: { id: true },
  });

  const icpIds = profiles.map((profile) => profile.id);
  if (icpIds.length === 0) {
    return;
  }

  await prisma.qualificationRule.deleteMany({
    where: {
      icpProfileId: {
        in: icpIds,
      },
    },
  });

  await prisma.icpProfile.deleteMany({
    where: {
      id: {
        in: icpIds,
      },
    },
  });
}

describe('icp.seed', () => {
  beforeEach(async () => {
    await cleanupSeededIcps();
  });

  it('creates four active U.S. B2B SaaS ICPs and supports idempotent reruns', async () => {
    runSeedScript();

    for (const icpName of DEMO_ICP_NAMES) {
      const icp = await prisma.icpProfile.findFirst({
        where: { name: icpName },
        include: {
          qualificationRules: {
            orderBy: [{ orderIndex: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
          },
        },
      });

      expect(icp).not.toBeNull();
      if (!icp) {
        continue;
      }

      expect(icp.isActive).toBe(true);
      expect(icp.qualificationLogic).toBe('WEIGHTED');
      expect(icp.createdByUserId).toBeNull();
      expect(icp.metadataJson).toMatchObject({
        strategy: 'generic_b2b_saas',
      });
      expect(icp.qualificationRules).toHaveLength(EXPECTED_RULE_COUNTS[icpName]);

      const requiredRules = icp.qualificationRules.filter((rule) => rule.isRequired);
      expect(requiredRules).toHaveLength(3);
      expect(requiredRules.map((rule) => rule.fieldKey)).toEqual([
        'country',
        'has_domain',
        'has_email',
      ]);

      const orderIndexes = icp.qualificationRules.map((rule) => rule.orderIndex);
      expect(orderIndexes).toEqual(
        Array.from({ length: EXPECTED_RULE_COUNTS[icpName] }, (_, index) => index + 1),
      );
    }

    runSeedScript();

    const allSeededIcpCount = await prisma.icpProfile.count({
      where: {
        name: {
          in: DEMO_ICP_NAMES,
        },
      },
    });
    expect(allSeededIcpCount).toBe(4);
  });
});
