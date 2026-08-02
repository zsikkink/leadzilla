'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdminListSearchTasksQuery, AdminListSearchTasksResponse } from '@lead-flood/contracts';

import { CustomSelect } from '../../../src/components/custom-select.js';
import {
  fetchAdminSearchTasks,
  queryFromSearchTaskFilters,
} from '../../../src/lib/discovery-admin';
import { toDiscoveryRunNotice, toSafeDisplayErrorMessage } from '../../../src/lib/error-messages.js';

const DEFAULT_QUERY: AdminListSearchTasksQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'updated_desc',
};

function statusClassName(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'status-pill status-running';
    case 'DONE':
      return 'status-pill status-done';
    case 'FAILED':
      return 'status-pill status-failed';
    case 'SKIPPED':
      return 'status-pill status-skipped';
    default:
      return 'status-pill status-pending';
  }
}

export default function SearchTasksPage() {
  const [query, setQuery] = useState<AdminListSearchTasksQuery>(DEFAULT_QUERY);
  const [data, setData] = useState<AdminListSearchTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(
    async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchAdminSearchTasks(queryFromSearchTaskFilters(query));
        setData(result);
      } catch (loadError: unknown) {
        setError(
          toSafeDisplayErrorMessage(
            loadError,
            'Search tasks are refreshing. Please try again in a moment.',
          ),
        );
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="card">
      <h2>Search Tasks Explorer</h2>
      <p className="muted">Inspect frontier tasks, request params, state transitions, and errors.</p>
      {/* Live updates control disabled for now. */}

      <div className="filters" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div>
          <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Status</span>
          <CustomSelect
            value={query.status ?? ''}
            onChange={(val) =>
              setQuery((prev) => ({
                ...prev,
                page: 1,
                status: val ? (val as AdminListSearchTasksQuery['status']) : undefined,
              }))
            }
            options={[
              { value: '', label: 'Any' },
              { value: 'PENDING', label: 'PENDING' },
              { value: 'RUNNING', label: 'RUNNING' },
              { value: 'DONE', label: 'DONE' },
              { value: 'FAILED', label: 'FAILED' },
              { value: 'SKIPPED', label: 'SKIPPED' },
            ]}
            placeholder="Any"
          />
        </div>
        <div>
          <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Task Type</span>
          <CustomSelect
            value={query.taskType ?? ''}
            onChange={(val) =>
              setQuery((prev) => ({
                ...prev,
                page: 1,
                taskType: val ? (val as AdminListSearchTasksQuery['taskType']) : undefined,
              }))
            }
            options={[
              { value: '', label: 'Any' },
              { value: 'SERP_GOOGLE', label: 'SERP_GOOGLE' },
              { value: 'SERP_GOOGLE_LOCAL', label: 'SERP_GOOGLE_LOCAL' },
              { value: 'SERP_MAPS_LOCAL', label: 'SERP_MAPS_LOCAL' },
            ]}
            placeholder="Any"
          />
        </div>
        <div>
          <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Country</span>
          <CustomSelect
            value={query.countryCode ?? ''}
            onChange={(val) =>
              setQuery((prev) => ({
                ...prev,
                page: 1,
                countryCode: val || undefined,
              }))
            }
            options={[
              { value: '', label: 'Any' },
              { value: 'AE', label: 'AE' },
              { value: 'SA', label: 'SA' },
              { value: 'JO', label: 'JO' },
              { value: 'EG', label: 'EG' },
            ]}
            placeholder="Any"
          />
        </div>
        <div>
          <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Time Bucket</span>
          <input
            value={query.timeBucket ?? ''}
            onChange={(event) =>
              setQuery((prev) => ({
                ...prev,
                page: 1,
                timeBucket: event.target.value || undefined,
              }))
            }
            placeholder="2026-W08:small-validation"
          />
        </div>
        <div>
          <span className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Sort</span>
          <CustomSelect
            value={query.sortBy ?? 'updated_desc'}
            onChange={(val) =>
              setQuery((prev) => ({
                ...prev,
                page: 1,
                sortBy: val as AdminListSearchTasksQuery['sortBy'],
              }))
            }
            options={[
              { value: 'updated_desc', label: 'Updated (desc)' },
              { value: 'run_after_asc', label: 'Run after (asc)' },
              { value: 'attempts_desc', label: 'Attempts (desc)' },
            ]}
            placeholder="Sort by"
          />
        </div>
      </div>

      {error ? (
        <p style={{ color: '#b7791f', marginTop: 10 }}>
          <strong>Pipeline note:</strong> {error}
        </p>
      ) : null}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Country / City / Lang</th>
              <th>Query</th>
              <th>Bucket</th>
              <th>Attempts</th>
              <th>Run After</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {!data && loading ? (
              <tr>
                <td colSpan={8}>Loading search tasks...</td>
              </tr>
            ) : data && data.items.length > 0 ? (
              data.items.map((task) => (
                <tr key={task.id}>
                  <td>
                    <Link className="row-link mono" href={`/discovery/search-tasks/${task.id}`}>
                      {task.id}
                    </Link>
                    <div className="muted">{task.taskType}</div>
                  </td>
                  <td>
                    <span className={statusClassName(task.status)}>{task.status}</span>
                  </td>
                  <td>
                    {task.countryCode} / {task.city ?? '-'} / {task.language}
                  </td>
                  <td className="mono">{task.queryText}</td>
                  <td className="mono">{task.timeBucket}</td>
                  <td>{task.attempts}</td>
                  <td>{new Date(task.runAfter).toLocaleString()}</td>
                  <td className="mono">{toDiscoveryRunNotice(task.error) ?? '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8}>No search tasks found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination" style={{ marginTop: 10 }}>
        <span className="muted">
          Page {query.page} of {totalPages} ({data?.total ?? 0} total)
        </span>
        <button
          type="button"
          className="secondary"
          disabled={(query.page ?? 1) <= 1}
          onClick={() =>
            setQuery((prev) => ({
              ...prev,
              page: Math.max(1, (prev.page ?? 1) - 1),
            }))
          }
        >
          Previous
        </button>
        <button
          type="button"
          className="secondary"
          disabled={(query.page ?? 1) >= totalPages}
          onClick={() =>
            setQuery((prev) => ({
              ...prev,
              page: (prev.page ?? 1) + 1,
            }))
          }
        >
          Next
        </button>
      </div>
    </section>
  );
}
