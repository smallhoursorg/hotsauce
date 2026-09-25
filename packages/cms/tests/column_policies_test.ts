// Tests for column-level policies

import { assertEquals } from '@std/assert';
import {
  evaluateColumnPolicies,
  extractColumnPolicies,
  extractRowPolicy,
  filterRecordColumns,
  filterRecordsColumns,
  injectColumnDefaults,
  isTablePolicy,
} from '../policies/apply.ts';
import type {
  ColumnPolicies,
  Policy,
  PolicyContext,
  TablePolicy,
} from '../policies/types.ts';
import type { IntrospectedColumn } from '@hotsauce/core';

// Helper to create test contexts
function createTestContext(
  user?: { sub: string; role?: string },
): PolicyContext {
  return {
    user,
    request: new Request('http://localhost/admin/users'),
  };
}

// Helper to create mock introspected columns
function createMockColumns(): IntrospectedColumn[] {
  return [
    {
      dbName: 'id',
      propertyName: 'id',
      columnType: 'PgSerial',
      dataType: 'number',
      notNull: true,
      hasDefault: true,
      isPrimaryKey: true,
      isUnique: true,
    },
    {
      dbName: 'name',
      propertyName: 'name',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'email',
      propertyName: 'email',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: true,
    },
    {
      dbName: 'salary',
      propertyName: 'salary',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'ssn',
      propertyName: 'ssn',
      columnType: 'PgText',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'tenant_id',
      propertyName: 'tenantId',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];
}

// ============================================================================
// Type guards
// ============================================================================

Deno.test('isTablePolicy: returns false for undefined', () => {
  assertEquals(isTablePolicy(undefined), false);
});

Deno.test('isTablePolicy: returns false for function (PolicyFn)', () => {
  const policy: Policy = () => undefined;
  assertEquals(isTablePolicy(policy), false);
});

Deno.test('isTablePolicy: returns false for ActionPolicies', () => {
  const policy: Policy = {
    list: () => undefined,
    create: () => false,
  };
  assertEquals(isTablePolicy(policy), false);
});

Deno.test('isTablePolicy: returns true for TablePolicy with row', () => {
  const policy: TablePolicy = {
    row: () => undefined,
  };
  assertEquals(isTablePolicy(policy), true);
});

Deno.test('isTablePolicy: returns true for TablePolicy with columns', () => {
  const policy: TablePolicy = {
    columns: {
      salary: { read: () => false },
    },
  };
  assertEquals(isTablePolicy(policy), true);
});

Deno.test('isTablePolicy: returns true for TablePolicy with row and columns', () => {
  const policy: TablePolicy = {
    row: () => undefined,
    columns: {
      salary: { read: () => false },
    },
  };
  assertEquals(isTablePolicy(policy), true);
});

// ============================================================================
// Extract helpers
// ============================================================================

Deno.test('extractRowPolicy: returns undefined for undefined input', () => {
  assertEquals(extractRowPolicy(undefined), undefined);
});

Deno.test('extractRowPolicy: returns policy for simple PolicyFn', () => {
  const policy: Policy = () => undefined;
  assertEquals(extractRowPolicy(policy), policy);
});

Deno.test('extractRowPolicy: returns row from TablePolicy', () => {
  const rowPolicy: Policy = () => undefined;
  const tablePolicy: TablePolicy = {
    row: rowPolicy,
    columns: { salary: { read: () => false } },
  };
  assertEquals(extractRowPolicy(tablePolicy), rowPolicy);
});

Deno.test('extractRowPolicy: returns undefined for TablePolicy without row', () => {
  const tablePolicy: TablePolicy = {
    columns: { salary: { read: () => false } },
  };
  assertEquals(extractRowPolicy(tablePolicy), undefined);
});

Deno.test('extractColumnPolicies: returns undefined for undefined input', () => {
  assertEquals(extractColumnPolicies(undefined), undefined);
});

Deno.test('extractColumnPolicies: returns undefined for simple PolicyFn', () => {
  const policy: Policy = () => undefined;
  assertEquals(extractColumnPolicies(policy), undefined);
});

Deno.test('extractColumnPolicies: returns columns from TablePolicy', () => {
  const columnPolicies: ColumnPolicies = {
    salary: { read: () => false },
  };
  const tablePolicy: TablePolicy = {
    columns: columnPolicies,
  };
  assertEquals(extractColumnPolicies(tablePolicy), columnPolicies);
});

// ============================================================================
// evaluateColumnPolicies
// ============================================================================

Deno.test('evaluateColumnPolicies: no policies = all columns accessible', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });

  const result = await evaluateColumnPolicies(undefined, columns, ctx);

  // All columns should be readable
  assertEquals(result.readableColumns.length, columns.length);
  // All non-auto columns should be writable
  assertEquals(result.writableColumns.includes('name'), true);
  assertEquals(result.writableColumns.includes('email'), true);
  assertEquals(result.writableColumns.includes('salary'), true);
  // Auto-generated PK should not be writable
  assertEquals(result.writableColumns.includes('id'), false);
  // No defaults
  assertEquals(Object.keys(result.defaults).length, 0);
});

Deno.test('evaluateColumnPolicies: read: false hides column', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  const columnPolicies: ColumnPolicies = {
    ssn: { read: () => false },
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  assertEquals(result.readableColumns.includes('ssn'), false);
  assertEquals(result.writableColumns.includes('ssn'), false);
});

Deno.test('evaluateColumnPolicies: primary key always readable', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  const columnPolicies: ColumnPolicies = {
    id: { read: () => false }, // Try to hide PK
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  // PK should still be readable (needed for routing)
  assertEquals(result.readableColumns.includes('id'), true);
});

Deno.test('evaluateColumnPolicies: role-based visibility', async () => {
  const columns = createMockColumns();
  const adminCtx = createTestContext({ sub: 'admin-1', role: 'admin' });
  const userCtx = createTestContext({ sub: 'user-1', role: 'editor' });
  const columnPolicies: ColumnPolicies = {
    salary: { read: (ctx) => ctx.user?.role === 'admin' },
  };

  const adminResult = await evaluateColumnPolicies(
    columnPolicies,
    columns,
    adminCtx,
  );
  const userResult = await evaluateColumnPolicies(
    columnPolicies,
    columns,
    userCtx,
  );

  // Admin can see salary
  assertEquals(adminResult.readableColumns.includes('salary'), true);
  // Regular user cannot
  assertEquals(userResult.readableColumns.includes('salary'), false);
});

Deno.test('evaluateColumnPolicies: write: false makes column read-only', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  const columnPolicies: ColumnPolicies = {
    email: { write: () => false },
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  // Email is readable but not writable
  assertEquals(result.readableColumns.includes('email'), true);
  assertEquals(result.writableColumns.includes('email'), false);
});

Deno.test('evaluateColumnPolicies: read: false implies write: false', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  const columnPolicies: ColumnPolicies = {
    ssn: { read: () => false }, // No explicit write policy
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  // Should not be writable when not readable
  assertEquals(result.writableColumns.includes('ssn'), false);
});

Deno.test('evaluateColumnPolicies: primary key is always readable even with read: false', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  const columnPolicies: ColumnPolicies = {
    id: { read: () => false }, // Try to hide PK
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  // PK must remain readable (needed for routing/links)
  assertEquals(result.readableColumns.includes('id'), true);
  // PK should not be writable (it's auto-generated)
  assertEquals(result.writableColumns.includes('id'), false);
});

Deno.test('evaluateColumnPolicies: collects defaults for hidden columns', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });
  // deno-lint-ignore no-explicit-any
  (ctx.user as any).tenantId = 'tenant-123'; // Add custom claim for multi-tenant test

  // Policy key uses propertyName (camelCase), not column name (snake_case)
  const columnPolicies: ColumnPolicies = {
    tenantId: {
      read: () => false,
      // deno-lint-ignore no-explicit-any
      default: (ctx) => (ctx.user as any)?.tenantId ?? 'default',
    },
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  // Defaults also use propertyName as key (for form data merge compatibility)
  assertEquals(result.defaults['tenantId'], 'tenant-123');
});

Deno.test('evaluateColumnPolicies: async policy functions work', async () => {
  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1', role: 'admin' });
  const columnPolicies: ColumnPolicies = {
    salary: {
      read: async (ctx) => {
        // Simulate async check (e.g., database lookup)
        await Promise.resolve();
        return ctx.user?.role === 'admin';
      },
    },
  };

  const result = await evaluateColumnPolicies(columnPolicies, columns, ctx);

  assertEquals(result.readableColumns.includes('salary'), true);
});

Deno.test('evaluateColumnPolicies: uses propertyName NOT column name for policy lookup', async () => {
  // This test explicitly verifies that policies are keyed by Drizzle's propertyName
  // (camelCase) not the database column name (snake_case).
  //
  // The mock columns have: name='tenant_id', propertyName='tenantId'
  // Policy should be keyed by 'tenantId' (propertyName), not 'tenant_id' (column name)

  const columns = createMockColumns();
  const ctx = createTestContext({ sub: 'user-1' });

  // CORRECT: Policy keyed by propertyName
  const correctPolicy: ColumnPolicies = {
    tenantId: { read: () => false }, // propertyName
  };

  // WRONG: Policy keyed by column name (should have no effect)
  const wrongPolicy: ColumnPolicies = {
    tenant_id: { read: () => false }, // column name - won't match!
  };

  const correctResult = await evaluateColumnPolicies(
    correctPolicy,
    columns,
    ctx,
  );
  const wrongResult = await evaluateColumnPolicies(wrongPolicy, columns, ctx);

  // Using propertyName correctly hides the column
  assertEquals(
    correctResult.readableColumns.includes('tenantId'),
    false,
    'Policy by propertyName should hide the column',
  );

  // Using column name does NOT hide the column (policy is ignored)
  assertEquals(
    wrongResult.readableColumns.includes('tenantId'),
    true,
    'Policy by column name should be ignored (column stays visible)',
  );
});

// ============================================================================
// Filter helpers
// ============================================================================

Deno.test('filterRecordColumns: keeps only readable columns', () => {
  const record = {
    id: 1,
    name: 'John',
    email: 'john@example.com',
    salary: 100000,
    ssn: '123-45-6789',
  };

  // Mock column metadata (all columns use same name as propertyName for simplicity)
  const columns: IntrospectedColumn[] = [
    { dbName: 'id', propertyName: 'id' } as IntrospectedColumn,
    { dbName: 'name', propertyName: 'name' } as IntrospectedColumn,
    { dbName: 'email', propertyName: 'email' } as IntrospectedColumn,
    { dbName: 'salary', propertyName: 'salary' } as IntrospectedColumn,
    { dbName: 'ssn', propertyName: 'ssn' } as IntrospectedColumn,
  ];

  const filtered = filterRecordColumns(
    record,
    ['id', 'name', 'email'],
    columns,
  );

  assertEquals(filtered, { id: 1, name: 'John', email: 'john@example.com' });
  assertEquals('salary' in filtered, false);
  assertEquals('ssn' in filtered, false);
});

Deno.test('filterRecordColumns: handles snake_case columns with camelCase properties', () => {
  const record = {
    id: 1,
    userName: 'John', // camelCase property from Drizzle
    emailAddress: 'john@example.com',
  };

  // Mock column metadata with snake_case DB names
  const columns: IntrospectedColumn[] = [
    { dbName: 'id', propertyName: 'id' } as IntrospectedColumn,
    { dbName: 'user_name', propertyName: 'userName' } as IntrospectedColumn,
    {
      dbName: 'email_address',
      propertyName: 'emailAddress',
    } as IntrospectedColumn,
  ];

  const filtered = filterRecordColumns(record, ['id', 'userName'], columns);

  assertEquals(filtered, { id: 1, userName: 'John' });
  assertEquals('emailAddress' in filtered, false);
});

Deno.test('filterRecordColumns: handles missing columns gracefully', () => {
  const record = { id: 1, name: 'John' };

  const columns: IntrospectedColumn[] = [
    { dbName: 'id', propertyName: 'id' } as IntrospectedColumn,
    { dbName: 'name', propertyName: 'name' } as IntrospectedColumn,
  ];

  const filtered = filterRecordColumns(
    record,
    ['id', 'name', 'nonexistent'],
    columns,
  );

  assertEquals(filtered, { id: 1, name: 'John' });
});

Deno.test('filterRecordsColumns: filters array of records', () => {
  const records = [
    { id: 1, name: 'John', ssn: '111-11-1111' },
    { id: 2, name: 'Jane', ssn: '222-22-2222' },
  ];

  const columns: IntrospectedColumn[] = [
    { dbName: 'id', propertyName: 'id' } as IntrospectedColumn,
    { dbName: 'name', propertyName: 'name' } as IntrospectedColumn,
    { dbName: 'ssn', propertyName: 'ssn' } as IntrospectedColumn,
  ];

  const filtered = filterRecordsColumns(records, ['id', 'name'], columns);

  assertEquals(filtered, [
    { id: 1, name: 'John' },
    { id: 2, name: 'Jane' },
  ]);
});

// ============================================================================
// Default injection
// ============================================================================

Deno.test('injectColumnDefaults: merges defaults into form data', () => {
  const formData = { name: 'New Record', email: 'new@example.com' };
  const defaults = { tenantId: 'tenant-123', createdBy: 'user-456' };

  const result = injectColumnDefaults(formData, defaults);

  assertEquals(result, {
    name: 'New Record',
    email: 'new@example.com',
    tenantId: 'tenant-123',
    createdBy: 'user-456',
  });
});

Deno.test('injectColumnDefaults: form data takes precedence', () => {
  const formData = { name: 'New Record', tenantId: 'form-tenant' };
  const defaults = { tenantId: 'default-tenant' };

  const result = injectColumnDefaults(formData, defaults);

  // Form data value wins
  assertEquals(result.tenantId, 'form-tenant');
});

Deno.test('injectColumnDefaults: handles empty defaults', () => {
  const formData = { name: 'New Record' };
  const defaults = {};

  const result = injectColumnDefaults(formData, defaults);

  assertEquals(result, { name: 'New Record' });
});
