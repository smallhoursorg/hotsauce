// Micro-benchmarks: row/column policy application — runs on every request
// when policies are configured. Run with: deno task bench

import { sql } from 'drizzle-orm';
import { introspectTable } from '@hotsauce/core';
import { users } from '../../core/tests/fixtures/schema-pg.ts';
import {
  buildPolicyWhere,
  createPolicyContext,
  filterRecordsColumns,
} from '../policies/apply.ts';

const usersInfo = introspectTable(users);
const tenantCondition = sql`tenant_id = ${'tenant-1'}`;

Deno.bench('buildPolicyWhere: pk check + policy condition', () => {
  buildPolicyWhere(users, usersInfo, '42', tenantCondition);
});

const request = new Request('http://localhost/admin/users');

Deno.bench('createPolicyContext', () => {
  createPolicyContext(request, { id: 'user-1', role: 'editor' }, 'form');
});

// Column filtering scales with row count: strip one hidden column
// from result sets of 100 and 1,000 rows.
const columns = usersInfo.columns;
const readable = columns
  .filter((c) => c.propertyName !== 'email')
  .map((c) => c.propertyName);

function makeRecords(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) =>
    Object.fromEntries(
      columns.map((c) => [c.propertyName, `${c.propertyName}-${i}`]),
    ));
}

const rows100 = makeRecords(100);
const rows1000 = makeRecords(1000);

Deno.bench(
  'filterRecordsColumns: 100 rows',
  { group: 'column filtering', baseline: true },
  () => {
    filterRecordsColumns(rows100, readable, columns);
  },
);

Deno.bench(
  'filterRecordsColumns: 1,000 rows',
  { group: 'column filtering' },
  () => {
    filterRecordsColumns(rows1000, readable, columns);
  },
);
