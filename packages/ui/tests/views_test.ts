// Tests for view components

import { assertEquals, assertStringIncludes } from '@std/assert';
import { fieldsToListColumns, listTable, listView } from '../views/list.ts';
import { detailField, detailView } from '../views/detail.ts';
import { createView, editView } from '../views/edit.ts';
import {
  getGridItemLabel,
  gridDetailPanel,
  gridItems,
  gridView,
  resolveThumbnailUrl,
} from '../views/grid.ts';
import { viewToggle } from '../components/view-toggle.ts';
import type {
  GridPanelData,
  GridThumbnail,
  GridViewOptions,
} from '../views/grid.ts';
import type { CMSField, IntrospectedColumn } from '@hotsauce/core';

// Helper to create mock CMSField
function createMockField(overrides: Partial<CMSField> = {}): CMSField {
  const column: IntrospectedColumn = {
    dbName: 'test_field',
    propertyName: 'testField',
    dataType: 'string',
    columnType: 'PgVarchar',
    notNull: true,
    hasDefault: false,
    isPrimaryKey: false,
    isUnique: false,
    ...overrides.column,
  };

  return {
    column,
    fieldType: 'text',
    label: 'Test Field',
    ...overrides,
  };
}

// listTable tests
Deno.test('listTable: renders table with records', () => {
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'Name' },
  ];
  const records = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  assertStringIncludes(result, '<table');
  assertStringIncludes(result, '<th');
  assertStringIncludes(result, 'ID');
  assertStringIncludes(result, 'Name');
  assertStringIncludes(result, 'Alice');
  assertStringIncludes(result, 'Bob');
});

Deno.test('listTable: shows empty message when no records', () => {
  const columns = [{ key: 'id', label: 'ID' }];
  const result = listTable(columns, [], { baseUrl: '/admin/users' });

  assertStringIncludes(result, 'No records found');
  assertStringIncludes(result, 'Create New');
});

Deno.test('listTable: renders edit action', () => {
  const columns = [{ key: 'id', label: 'ID' }];
  const records = [{ id: 1 }];

  const result = listTable(columns, records, {
    baseUrl: '/admin/users',
    showEdit: true,
  });

  assertStringIncludes(result, '/admin/users/1/edit');
  assertStringIncludes(result, 'Edit');
});

Deno.test('listTable: renders delete action', () => {
  const columns = [{ key: 'id', label: 'ID' }];
  const records = [{ id: 1 }];

  const result = listTable(columns, records, {
    baseUrl: '/admin/users',
    showDelete: true,
  });

  assertStringIncludes(result, '/admin/users/1/delete');
  assertStringIncludes(result, 'Delete');
  assertStringIncludes(result, 'confirm');
});

Deno.test('listTable: escapes record values (no executable HTML)', () => {
  const columns = [{ key: 'name', label: 'Name' }];
  const records = [{ id: 1, name: '<script>alert("xss")</script>' }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  // Values are escaped, so no live <script> survives and the tags are shown
  // faithfully as text.
  assertEquals(result.includes('<script>'), false);
  assertStringIncludes(result, '&lt;script&gt;');
  assertStringIncludes(result, 'alert(&quot;xss&quot;)');
});

Deno.test('listTable: escapes stored markup faithfully (no tag stripping)', () => {
  const columns = [{ key: 'bioHtml', label: 'Bio Html' }];
  const records = [{ id: 1, bioHtml: '<p>A short bio</p>' }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  // Markup is shown faithfully as escaped text, not stripped.
  assertStringIncludes(result, '&lt;p&gt;');
  assertStringIncludes(result, 'A short bio');
});

Deno.test('listTable: wraps plain text cells in a clamp container', () => {
  const columns = [{ key: 'name', label: 'Name' }];
  const records = [{ id: 1, name: 'Alice' }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  assertStringIncludes(result, 'cms-cell-text');
});

Deno.test('listTable: truncates over-long text with an ellipsis', () => {
  const long = 'a'.repeat(150);
  const columns = [{ key: 'name', label: 'Name' }];
  const records = [{ id: 1, name: long }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  // Truncated to 100 chars + ellipsis; the full 150-char string is not shown
  // as visible cell text.
  assertStringIncludes(result, 'a'.repeat(100) + '…');
});

Deno.test('listTable: exposes the full value via a title tooltip when truncated', () => {
  const long = 'a'.repeat(150);
  const columns = [{ key: 'name', label: 'Name' }];
  const records = [{ id: 1, name: long }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  // The visible text is truncated, but the full value is available on hover.
  assertStringIncludes(result, `title="${long}"`);
});

Deno.test('listTable: does not truncate text at or under the limit', () => {
  const exact = 'b'.repeat(100);
  const columns = [{ key: 'name', label: 'Name' }];
  const records = [{ id: 1, name: exact }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  assertStringIncludes(result, exact);
  assertEquals(result.includes('…'), false);
});

Deno.test('listTable: leaves non-text cells (null, JSON, file badge) unclamped', () => {
  const columns = [
    { key: 'missing', label: 'Missing' },
    { key: 'data', label: 'Data' },
    { key: 'file', label: 'File' },
  ];
  const records = [{
    id: 1,
    missing: null,
    data: { some: 'object' },
    file: {
      key: 'uploads/x.pdf',
      filename: 'x.pdf',
      contentType: 'application/pdf',
      size: 100,
    },
  }];

  const result = listTable(columns, records, { baseUrl: '/admin/users' });

  // Trusted cell markup is emitted as-is, not stripped or clamped.
  assertStringIncludes(result, 'cms-null');
  assertStringIncludes(result, 'cms-json');
  assertStringIncludes(result, 'cms-file-badge');
  assertStringIncludes(result, 'x.pdf');
});

Deno.test('listTable: uses custom format function', () => {
  const columns = [{
    key: 'amount',
    label: 'Amount',
    format: (v: unknown) => `$${v}`,
  }];
  const records = [{ id: 1, amount: 100 }];

  const result = listTable(columns, records, { baseUrl: '/admin/orders' });

  assertStringIncludes(result, '$100');
});

// listView tests
Deno.test('listView: renders header with title and create button', () => {
  const columns = [{ key: 'id', label: 'ID' }];
  const records = [{ id: 1 }];

  const result = listView('Users', columns, records, {
    baseUrl: '/admin/users',
  });

  assertStringIncludes(result, '<h1>Users</h1>');
  assertStringIncludes(result, '/admin/users/new');
  assertStringIncludes(result, 'Create New');
});

// fieldsToListColumns tests
Deno.test('fieldsToListColumns: converts fields to columns', () => {
  const fields = [
    createMockField({
      column: { propertyName: 'id' } as IntrospectedColumn,
      label: 'ID',
    }),
    createMockField({
      column: { propertyName: 'name' } as IntrospectedColumn,
      label: 'Name',
    }),
  ];

  const columns = fieldsToListColumns(fields);

  assertEquals(columns.length, 2);
  assertEquals(columns[0]?.key, 'id');
  assertEquals(columns[0]?.label, 'ID');
});

Deno.test('fieldsToListColumns: excludes hidden fields', () => {
  const fields = [
    createMockField({
      column: { propertyName: 'id' } as IntrospectedColumn,
      label: 'ID',
      hidden: true,
    }),
    createMockField({
      column: { propertyName: 'name' } as IntrospectedColumn,
      label: 'Name',
    }),
  ];

  const columns = fieldsToListColumns(fields);

  assertEquals(columns.length, 1);
  assertEquals(columns[0]?.key, 'name');
});

Deno.test('fieldsToListColumns: respects exclude list', () => {
  const fields = [
    createMockField({
      column: { propertyName: 'id' } as IntrospectedColumn,
      label: 'ID',
    }),
    createMockField({
      column: { propertyName: 'password' } as IntrospectedColumn,
      label: 'Password',
    }),
  ];

  const columns = fieldsToListColumns(fields, ['password']);

  assertEquals(columns.length, 1);
  assertEquals(columns[0]?.key, 'id');
});

// detailField tests
Deno.test('detailField: renders field label and value', () => {
  const field = createMockField({ label: 'Username' });
  const result = detailField(field, 'john_doe');

  assertStringIncludes(result, 'Username');
  assertStringIncludes(result, 'john_doe');
});

Deno.test('detailField: returns empty for hidden fields', () => {
  const field = createMockField({ hidden: true });
  const result = detailField(field, 'secret');

  assertEquals(result, '');
});

Deno.test('detailField: formats null as dash', () => {
  const field = createMockField();
  const result = detailField(field, null);

  assertStringIncludes(result, 'cms-null');
  assertStringIncludes(result, '—');
});

Deno.test('detailField: formats boolean values', () => {
  const field = createMockField({ fieldType: 'boolean' });

  assertStringIncludes(detailField(field, true), 'Yes');
  assertStringIncludes(detailField(field, false), 'No');
});

Deno.test('detailField: formats JSON values', () => {
  const field = createMockField({ fieldType: 'json' });
  const result = detailField(field, { key: 'value' });

  assertStringIncludes(result, '<pre');
  // JSON gets escaped - quotes become &quot;
  assertStringIncludes(result, '&quot;key&quot;');
});

// FieldUIOverride tests for detail view
Deno.test('detailField: renders valueSummary instead of raw JSON when override provided', () => {
  const field = createMockField({ fieldType: 'json', label: 'Content' });
  const result = detailField(
    field,
    { content: [{}, {}, {}] },
    undefined,
    undefined,
    { valueSummary: '3 blocks' },
  );

  assertStringIncludes(result, 'cms-value-summary');
  assertStringIncludes(result, '3 blocks');
  // Raw JSON dump should NOT be present
  assertEquals(result.includes('<pre'), false);
  assertEquals(result.includes('&quot;content&quot;'), false);
});

Deno.test('detailField: renders link from override with target=_blank', () => {
  const field = createMockField({ fieldType: 'json', label: 'Content' });
  const result = detailField(
    field,
    { content: [] },
    undefined,
    undefined,
    {
      valueSummary: '0 blocks',
      link: {
        label: 'Edit with Puck',
        href: '/admin/puck/pages/1/content',
        target: '_blank',
      },
    },
  );

  assertStringIncludes(result, 'cms-field-override');
  assertStringIncludes(result, 'href="/admin/puck/pages/1/content"');
  assertStringIncludes(result, 'target="_blank"');
  assertStringIncludes(result, 'rel="noopener"');
  assertStringIncludes(result, 'Edit with Puck');
  // External-link glyph
  assertStringIncludes(result, '↗');
});

Deno.test('detailField: renders link-only override (no valueSummary) falls back to formatted value', () => {
  const field = createMockField({ fieldType: 'text', label: 'Name' });
  const result = detailField(
    field,
    'Alice',
    undefined,
    undefined,
    { link: { label: 'Open', href: '/foo' } },
  );

  // Raw value should still appear
  assertStringIncludes(result, 'Alice');
  // Link should be rendered
  assertStringIncludes(result, 'cms-field-override');
  assertStringIncludes(result, 'href="/foo"');
  // No target=_blank means no external glyph and no rel=noopener
  assertEquals(result.includes('target="_blank"'), false);
  assertEquals(result.includes('rel="noopener"'), false);
});

Deno.test('detailField: rejects unsafe javascript: URL in override link', () => {
  const field = createMockField({ fieldType: 'text', label: 'Name' });
  const result = detailField(
    field,
    'Alice',
    undefined,
    undefined,
    {
      valueSummary: 'summary',
      link: { label: 'Bad', href: 'javascript:alert(1)' },
    },
  );

  // Unsafe href should be dropped; no link rendered
  assertEquals(result.includes('javascript:'), false);
  assertEquals(result.includes('cms-field-override'), false);
  // Summary still renders
  assertStringIncludes(result, 'summary');
});

Deno.test('detailField: escapes valueSummary content (no HTML injection)', () => {
  const field = createMockField({ fieldType: 'json', label: 'Content' });
  const result = detailField(
    field,
    {},
    undefined,
    undefined,
    { valueSummary: '<script>alert(1)</script>' },
  );

  // The script tag must be escaped, not rendered as HTML
  assertEquals(result.includes('<script>alert(1)</script>'), false);
  assertStringIncludes(result, '&lt;script&gt;');
});

Deno.test('detailField: returns empty for hidden field even with override', () => {
  const field = createMockField({ hidden: true });
  const result = detailField(
    field,
    'value',
    undefined,
    undefined,
    { valueSummary: 'summary' },
  );

  assertEquals(result, '');
});

// File field rendering tests
Deno.test('detailField: renders image file with preview and download link', () => {
  const field = createMockField({
    fieldType: 'file',
    column: { propertyName: 'avatar', dbName: 'avatar' } as IntrospectedColumn,
    label: 'Avatar',
  });

  const fileValue = {
    key: 'uploads/avatar.jpg',
    filename: 'avatar.jpg',
    contentType: 'image/jpeg',
    size: 12345,
    storage: 's3',
  };

  const fileUrl = 'https://s3.example.com/bucket/avatar.jpg?signed=abc';
  const result = detailField(field, fileValue, undefined, fileUrl);

  // Should have image preview for image files
  assertStringIncludes(result, '<img');
  assertStringIncludes(
    result,
    'src="https://s3.example.com/bucket/avatar.jpg?signed=abc"',
  );
  assertStringIncludes(result, 'cms-file-preview');

  // Should have download link
  assertStringIncludes(
    result,
    '<a href="https://s3.example.com/bucket/avatar.jpg?signed=abc"',
  );
  assertStringIncludes(result, 'Download');

  // Should show file info
  assertStringIncludes(result, 'avatar.jpg');
  assertStringIncludes(result, 'image/jpeg');
});

Deno.test('detailField: renders document file with download link but NO image preview', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      propertyName: 'document',
      dbName: 'document',
    } as IntrospectedColumn,
    label: 'Document',
  });

  const fileValue = {
    key: 'uploads/report.pdf',
    filename: 'report.pdf',
    contentType: 'application/pdf',
    size: 54321,
    storage: 's3',
  };

  const fileUrl = 'https://s3.example.com/bucket/report.pdf?signed=xyz';
  const result = detailField(field, fileValue, undefined, fileUrl);

  // Should NOT have image preview for documents
  assertEquals(
    result.includes('<img'),
    false,
    'Document should not have img tag',
  );
  assertEquals(
    result.includes('cms-file-preview'),
    false,
    'Document should not have preview class',
  );

  // Should have download link with fileUrl
  assertStringIncludes(
    result,
    '<a href="https://s3.example.com/bucket/report.pdf?signed=xyz"',
  );
  assertStringIncludes(result, 'Download');

  // Should show file info
  assertStringIncludes(result, 'report.pdf');
  assertStringIncludes(result, 'application/pdf');

  // Should show document icon, not image icon
  assertStringIncludes(result, '📄');
  assertEquals(
    result.includes('🖼️'),
    false,
    'Document should not have image icon',
  );
});

Deno.test('detailField: does not preview SVG by default', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      propertyName: 'icon',
      dbName: 'icon',
      cmsOptions: { file: true },
    } as IntrospectedColumn,
  });

  const fileValue = {
    filename: 'icon.svg',
    contentType: 'image/svg+xml',
    size: 100,
    url: 'https://cdn.example.com/icon.svg',
  };

  const result = detailField(
    field,
    fileValue,
    undefined,
    'https://cdn.example.com/icon.svg?signed=1',
  );

  assertEquals(result.includes('cms-file-preview'), false);
  assertEquals(result.includes('<img'), false);
});

Deno.test('detailField: previews SVG when file.previewSvg is true', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      propertyName: 'icon',
      dbName: 'icon',
      cmsOptions: { file: { previewSvg: true } },
    } as IntrospectedColumn,
  });

  const fileValue = {
    filename: 'icon.svg',
    contentType: 'image/svg+xml',
    size: 100,
    url: 'https://cdn.example.com/icon.svg',
  };

  const result = detailField(
    field,
    fileValue,
    undefined,
    'https://cdn.example.com/icon.svg?signed=1',
  );

  assertStringIncludes(result, 'cms-file-preview');
  assertStringIncludes(result, '<img');
});

Deno.test('detailField: renders file without fileUrl using fallback URL', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      propertyName: 'document',
      dbName: 'document',
    } as IntrospectedColumn,
  });

  const fileValue = {
    key: 'uploads/doc.pdf',
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    size: 1000,
    url: 'https://cdn.example.com/doc.pdf', // fallback URL in file reference
  };

  // No fileUrl override - should use value.url
  const result = detailField(field, fileValue, undefined, undefined);

  assertStringIncludes(result, '<a href="https://cdn.example.com/doc.pdf"');
  assertStringIncludes(result, 'Download');
});

Deno.test('detailField: escapes fileUrl to prevent XSS', () => {
  const field = createMockField({
    fieldType: 'file',
    column: { propertyName: 'doc', dbName: 'doc' } as IntrospectedColumn,
  });

  const fileValue = {
    filename: 'test.pdf',
    contentType: 'application/pdf',
    size: 100,
  };

  // Attempt XSS via fileUrl
  const maliciousUrl =
    'https://example.com/file.pdf"><script>alert(1)</script>';
  const result = detailField(field, fileValue, undefined, maliciousUrl);

  // Should escape the URL
  assertStringIncludes(result, '&quot;');
  assertEquals(result.includes('<script>'), false);
});

// detailView tests
Deno.test('detailView: renders view with title and fields', () => {
  const fields = [
    createMockField({
      column: { propertyName: 'name' } as IntrospectedColumn,
      label: 'Name',
    }),
  ];
  const record = { name: 'Test' };

  const result = detailView('User Details', fields, record, {
    baseUrl: '/admin/users',
    id: 1,
  });

  assertStringIncludes(result, '<h1>User Details</h1>');
  assertStringIncludes(result, 'Name');
  assertStringIncludes(result, 'Test');
});

Deno.test('detailView: shows edit button when enabled', () => {
  const fields = [createMockField()];
  const result = detailView('Details', fields, {}, {
    baseUrl: '/admin/users',
    id: 1,
    showEdit: true,
  });

  assertStringIncludes(result, '/admin/users/1/edit');
  assertStringIncludes(result, 'Edit');
});

Deno.test('detailView: shows frontend URL link when provided', () => {
  const fields = [createMockField()];
  const result = detailView('Details', fields, {}, {
    baseUrl: '/admin/users',
    id: 1,
    frontendUrl: '/users/john',
  });

  assertStringIncludes(result, 'View on site');
  assertStringIncludes(result, 'href="/users/john"');
  assertStringIncludes(result, 'rel="noopener"');
  assertStringIncludes(result, 'target="_blank"');
});

Deno.test('detailView: hides frontend URL link when null', () => {
  const fields = [createMockField()];
  const result = detailView('Details', fields, {}, {
    baseUrl: '/admin/users',
    id: 1,
    frontendUrl: null,
  });

  assertEquals(result.includes('View on site'), false);
});

// editView tests
Deno.test('editView: renders form for editing', () => {
  const fields = [
    createMockField({ column: { propertyName: 'name' } as IntrospectedColumn }),
  ];

  const result = editView('Edit User', fields, {
    baseUrl: '/admin/users',
    id: 1,
  }, { name: 'John' });

  assertStringIncludes(result, '<h1>Edit User</h1>');
  assertStringIncludes(result, 'action="/admin/users/1"');
  assertStringIncludes(result, 'value="John"');
  assertStringIncludes(result, 'Update');
});

Deno.test('editView: shows frontend URL link when provided', () => {
  const fields = [
    createMockField({ column: { propertyName: 'name' } as IntrospectedColumn }),
  ];

  const result = editView('Edit User', fields, {
    baseUrl: '/admin/users',
    id: 1,
    frontendUrl: '/users/john',
  }, { name: 'John' });

  assertStringIncludes(result, 'View on site');
  assertStringIncludes(result, 'href="/users/john"');
  assertStringIncludes(result, 'rel="noopener"');
  assertStringIncludes(result, 'target="_blank"');
});

Deno.test('editView: hides frontend URL link when null', () => {
  const fields = [
    createMockField({ column: { propertyName: 'name' } as IntrospectedColumn }),
  ];

  const result = editView('Edit User', fields, {
    baseUrl: '/admin/users',
    id: 1,
    frontendUrl: null,
  }, { name: 'John' });

  assertEquals(result.includes('View on site'), false);
});

Deno.test('createView: renders form for creating', () => {
  const fields = [createMockField()];

  const result = createView('New User', fields, {
    baseUrl: '/admin/users',
  });

  assertStringIncludes(result, '<h1>New User</h1>');
  assertStringIncludes(result, 'action="/admin/users"');
  assertStringIncludes(result, 'Create');
});

Deno.test('editView: shows validation errors', () => {
  const fields = [
    createMockField({
      column: { propertyName: 'email' } as IntrospectedColumn,
    }),
  ];

  const result = editView(
    'Edit',
    fields,
    {
      baseUrl: '/admin/users',
      id: 1,
    },
    {},
    { email: 'Invalid email address' },
  );

  assertStringIncludes(result, 'Invalid email address');
  assertStringIncludes(result, 'cms-error');
});

// ─── Grid View Tests ─────────────────────────────────────────

function createGridOptions(
  overrides: Partial<GridViewOptions> = {},
): GridViewOptions {
  return {
    baseUrl: '/admin/media',
    thumbnailField: createMockField({
      column: {
        dbName: 'file',
        propertyName: 'file',
        dataType: 'json',
        columnType: 'PgJsonb',
        notNull: false,
        hasDefault: false,
        isPrimaryKey: false,
        isUnique: false,
        isArray: false,
        cmsOptions: { file: { accept: 'image/*' }, thumbnail: true },
      },
      fieldType: 'file',
      label: 'File',
      thumbnail: true,
    }),
    currentView: 'grid',
    currentUrl: '/admin/media',
    ...overrides,
  };
}

Deno.test('resolveThumbnailUrl: returns fileUrl when provided', () => {
  const ref = {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
    size: 1000,
    key: 'media/file/1/test.jpg',
  };
  assertEquals(
    resolveThumbnailUrl(ref, 'file', 'https://signed.example.com/test.jpg'),
    'https://signed.example.com/test.jpg',
  );
});

Deno.test('resolveThumbnailUrl: returns url from FileReference', () => {
  const ref = {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
    size: 1000,
    url: 'https://cdn.example.com/test.jpg',
  };
  assertEquals(
    resolveThumbnailUrl(ref, 'file'),
    'https://cdn.example.com/test.jpg',
  );
});

Deno.test('resolveThumbnailUrl: returns data URI from base64', () => {
  const ref = {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
    size: 1000,
    data: 'abc123',
  };
  const result = resolveThumbnailUrl(ref, 'file');
  assertEquals(result, 'data:image/jpeg;base64,abc123');
});

Deno.test('resolveThumbnailUrl: returns null for invalid FileReference', () => {
  assertEquals(resolveThumbnailUrl(null, 'file'), null);
  assertEquals(resolveThumbnailUrl(undefined, 'file'), null);
  assertEquals(resolveThumbnailUrl({}, 'file'), null);
});

Deno.test('resolveThumbnailUrl: handles plain URL string', () => {
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.jpg', 'text'),
    'https://example.com/img.jpg',
  );
});

Deno.test('resolveThumbnailUrl: returns null for empty string', () => {
  assertEquals(resolveThumbnailUrl('', 'text'), null);
});

Deno.test('resolveThumbnailUrl: skips SVG by default', () => {
  const ref = {
    filename: 'icon.svg',
    contentType: 'image/svg+xml',
    size: 500,
    url: 'https://cdn.example.com/icon.svg',
  };
  assertEquals(resolveThumbnailUrl(ref, 'file'), null);
});

Deno.test('resolveThumbnailUrl: allows SVG when previewSvg is true', () => {
  const ref = {
    filename: 'icon.svg',
    contentType: 'image/svg+xml',
    size: 500,
    url: 'https://cdn.example.com/icon.svg',
  };
  assertEquals(
    resolveThumbnailUrl(ref, 'file', undefined, { previewSvg: true }),
    'https://cdn.example.com/icon.svg',
  );
});

Deno.test('resolveThumbnailUrl: skips SVG URL string by default', () => {
  assertEquals(
    resolveThumbnailUrl('https://example.com/icon.svg', 'text'),
    null,
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/logo.SVG', 'text'),
    null,
  );
});

Deno.test('resolveThumbnailUrl: allows SVG URL string when previewSvg is true', () => {
  assertEquals(
    resolveThumbnailUrl('https://example.com/icon.svg', 'text', undefined, {
      previewSvg: true,
    }),
    'https://example.com/icon.svg',
  );
});

Deno.test('resolveThumbnailUrl: falls back to value.url when fileUrl is invalid', () => {
  const ref = {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
    size: 1000,
    url: 'https://cdn.example.com/test.jpg',
  };
  // fileUrl with javascript: scheme fails getSafeUrl validation
  assertEquals(
    resolveThumbnailUrl(ref, 'file', 'javascript:alert(1)'),
    'https://cdn.example.com/test.jpg',
  );
});

Deno.test('resolveThumbnailUrl: falls back to data URI when fileUrl is invalid', () => {
  const ref = {
    filename: 'test.jpg',
    contentType: 'image/jpeg',
    size: 1000,
    data: 'abc123',
  };
  // Invalid fileUrl, should fall back to data URI
  assertEquals(
    resolveThumbnailUrl(ref, 'file', 'javascript:alert(1)'),
    'data:image/jpeg;base64,abc123',
  );
});

Deno.test('resolveThumbnailUrl: returns null for non-image file contentType', () => {
  const pdfRef = {
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    size: 5000,
    url: 'https://cdn.example.com/doc.pdf',
  };
  assertEquals(resolveThumbnailUrl(pdfRef, 'file'), null);

  const textRef = {
    filename: 'readme.txt',
    contentType: 'text/plain',
    size: 100,
    url: 'https://cdn.example.com/readme.txt',
  };
  assertEquals(resolveThumbnailUrl(textRef, 'file'), null);

  const videoRef = {
    filename: 'video.mp4',
    contentType: 'video/mp4',
    size: 100000,
    url: 'https://cdn.example.com/video.mp4',
  };
  assertEquals(resolveThumbnailUrl(videoRef, 'file'), null);
});

Deno.test('resolveThumbnailUrl: returns null for non-image URL strings', () => {
  // URL without extension
  assertEquals(resolveThumbnailUrl('https://example.com/file', 'url'), null);
  // PDF URL
  assertEquals(
    resolveThumbnailUrl('https://example.com/doc.pdf', 'text'),
    null,
  );
  // Video URL
  assertEquals(
    resolveThumbnailUrl('https://example.com/video.mp4', 'text'),
    null,
  );
  // HTML URL
  assertEquals(
    resolveThumbnailUrl('https://example.com/page.html', 'text'),
    null,
  );
});

Deno.test('resolveThumbnailUrl: accepts various image URL extensions', () => {
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.jpg', 'text'),
    'https://example.com/img.jpg',
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.jpeg', 'text'),
    'https://example.com/img.jpeg',
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.png', 'text'),
    'https://example.com/img.png',
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.gif', 'text'),
    'https://example.com/img.gif',
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.webp', 'text'),
    'https://example.com/img.webp',
  );
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.avif', 'text'),
    'https://example.com/img.avif',
  );
});

Deno.test('resolveThumbnailUrl: handles query strings in image URLs', () => {
  assertEquals(
    resolveThumbnailUrl('https://example.com/img.png?width=100', 'text'),
    'https://example.com/img.png?width=100',
  );
});

Deno.test('viewToggle: renders with grid active', () => {
  const result = viewToggle({
    currentView: 'grid',
    currentUrl: '/admin/media',
  });
  assertStringIncludes(result, 'cms-view-toggle-active');
  assertStringIncludes(result, '?view=grid');
  assertStringIncludes(result, '?view=table');
});

Deno.test('viewToggle: renders with table active', () => {
  const result = viewToggle({
    currentView: 'table',
    currentUrl: '/admin/media',
  });
  assertStringIncludes(result, 'cms-view-toggle-active');
});

Deno.test('viewToggle: preserves existing query params', () => {
  const result = viewToggle({
    currentView: 'grid',
    currentUrl: '/admin/media?page=2',
  });
  assertStringIncludes(result, 'page=2');
  assertStringIncludes(result, 'view=grid');
});

Deno.test('gridItems: renders thumbnails', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
    { id: 2, thumbnailUrl: 'https://example.com/b.jpg', label: 'Photo B' },
  ];
  const records = [
    { id: 1, file: null },
    { id: 2, file: null },
  ];
  const options = createGridOptions();

  const result = gridItems(records, thumbnails, options);
  assertStringIncludes(result, 'cms-grid');
  assertStringIncludes(result, 'cms-grid-item');
  assertStringIncludes(result, 'Photo A');
  assertStringIncludes(result, 'Photo B');
  assertStringIncludes(result, 'loading="lazy"');
});

Deno.test('gridItems: renders placeholder for missing thumbnails', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: null, label: 'No image' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions();

  const result = gridItems(records, thumbnails, options);
  assertStringIncludes(result, 'cms-grid-placeholder');
});

Deno.test('gridItems: renders empty state', () => {
  const options = createGridOptions();
  const result = gridItems([], [], options);
  assertStringIncludes(result, 'cms-empty');
  assertStringIncludes(result, 'No records found');
  assertStringIncludes(result, 'Create New');
});

Deno.test('gridView: renders complete view with toggle', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions();

  const result = gridView('Media', records, thumbnails, options);
  assertStringIncludes(result, 'cms-list-view');
  assertStringIncludes(result, 'cms-view-toggle');
  assertStringIncludes(result, 'Media');
  assertStringIncludes(result, 'Create New');
  assertStringIncludes(result, 'cms-grid');
});

// ─── Grid Item Selection Tests ───────────────────────────────

Deno.test('gridItems: links to ?selected=<id> instead of /<id>', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions();

  const result = gridItems(records, thumbnails, options);
  assertStringIncludes(result, '?selected=1');
  // Should NOT link directly to detail page
  assertEquals(result.includes('href="/admin/media/1"'), false);
});

Deno.test('gridItems: highlights selected item', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
    { id: 2, thumbnailUrl: 'https://example.com/b.jpg', label: 'Photo B' },
  ];
  const records = [
    { id: 1, file: null },
    { id: 2, file: null },
  ];
  const options = createGridOptions({ selectedId: 1 });

  const result = gridItems(records, thumbnails, options);
  assertStringIncludes(result, 'cms-grid-item-selected');
});

Deno.test('gridItems: preserves query params in selected link', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: null, label: 'Test' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions({
    currentUrl: '/admin/media?page=2&sort=title',
  });

  const result = gridItems(records, thumbnails, options);
  assertStringIncludes(result, 'page=2');
  assertStringIncludes(result, 'sort=title');
  assertStringIncludes(result, 'selected=1');
});

// ─── Grid Detail Panel Tests ─────────────────────────────────

function createMockPanelData(
  overrides: Partial<GridPanelData> = {},
): GridPanelData {
  return {
    id: 1,
    thumbnailUrl: 'https://example.com/photo.jpg',
    fileMeta: {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    },
    fields: [
      createMockField({
        column: {
          dbName: 'title',
          propertyName: 'title',
          dataType: 'string',
          columnType: 'PgVarchar',
          notNull: true,
          hasDefault: false,
          isPrimaryKey: false,
          isUnique: false,
        },
        fieldType: 'text',
        label: 'Title',
      }),
    ],
    values: { title: 'My Photo' },
    errors: {},
    relationData: {},
    manyToManyData: [],
    fieldOverrides: {},
    csrfToken: 'test-csrf-token',
    sourceToken: 'test-source-token',
    returnUrl: '/admin/media',
    ...overrides,
  };
}

Deno.test('gridDetailPanel: renders thumbnail preview', () => {
  const panel = createMockPanelData();
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'cms-panel-preview');
  assertStringIncludes(result, 'https://example.com/photo.jpg');
});

Deno.test('gridDetailPanel: renders file metadata', () => {
  const panel = createMockPanelData();
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'photo.jpg');
  assertStringIncludes(result, 'image/jpeg');
  assertStringIncludes(result, '1.0 KB');
});

Deno.test('gridDetailPanel: renders edit form with fields', () => {
  const panel = createMockPanelData();
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'cms-panel-form');
  assertStringIncludes(result, 'name="title"');
  assertStringIncludes(result, 'My Photo');
  assertStringIncludes(result, 'Save');
});

Deno.test('gridDetailPanel: renders delete button', () => {
  const panel = createMockPanelData();
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'Delete');
  assertStringIncludes(result, 'data-confirm');
  assertStringIncludes(result, '/admin/media/1/delete');
});

Deno.test('gridDetailPanel: includes __cms_return hidden field', () => {
  const panel = createMockPanelData({ returnUrl: '/admin/media' });
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'name="__cms_return"');
  assertStringIncludes(result, 'value="/admin/media"');
});

Deno.test('gridDetailPanel: includes CSRF token', () => {
  const panel = createMockPanelData({ csrfToken: 'my-csrf-token' });
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'name="__cms_csrf"');
  assertStringIncludes(result, 'my-csrf-token');
});

Deno.test('gridDetailPanel: renders close button', () => {
  const panel = createMockPanelData();
  const options = createGridOptions({
    selectedId: 1,
    currentUrl: '/admin/media?selected=1',
  });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'cms-panel-close');
  // Close link should remove ?selected param
  assertStringIncludes(result, 'href="/admin/media"');
});

Deno.test('gridDetailPanel: uses filename in alt text when available', () => {
  const panel = createMockPanelData({
    fileMeta: {
      filename: 'vacation.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    },
  });
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'alt="Preview of vacation.jpg"');
});

Deno.test('gridDetailPanel: uses record ID in alt text when no fileMeta', () => {
  const panel = createMockPanelData({
    id: 42,
    fileMeta: undefined,
  });
  const options = createGridOptions({ selectedId: 42 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'alt="Preview for record 42"');
});

Deno.test('gridDetailPanel: renders placeholder when no thumbnail', () => {
  const panel = createMockPanelData({
    thumbnailUrl: null,
    fileMeta: undefined,
  });
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  assertStringIncludes(result, 'cms-panel-preview-placeholder');
});

Deno.test('gridDetailPanel: renders many-to-many checkboxes', () => {
  const panel = createMockPanelData({
    manyToManyData: [
      {
        fieldName: 'categoryIds',
        label: 'Categories',
        relatedTable: 'categories',
        options: [
          { value: '1', label: 'News' },
          { value: '2', label: 'Sports' },
          { value: '3', label: 'Tech' },
        ],
        selectedValues: ['1', '3'],
      },
    ],
  });
  const options = createGridOptions({ selectedId: 1 });

  const result = gridDetailPanel(panel, options);
  // Should render M2M label
  assertStringIncludes(result, 'Categories');
  // Should render checkboxes with correct name
  assertStringIncludes(result, 'name="categoryIds"');
  // Should render all options
  assertStringIncludes(result, 'News');
  assertStringIncludes(result, 'Sports');
  assertStringIncludes(result, 'Tech');
});

Deno.test('gridView: renders panel when panelData provided', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions({ selectedId: 1 });
  const panel = createMockPanelData();

  const result = gridView('Media', records, thumbnails, options, panel);
  assertStringIncludes(result, 'cms-grid-panel-layout');
  assertStringIncludes(result, 'cms-grid-panel');
  assertStringIncludes(result, 'cms-grid-main');
});

// --- getGridItemLabel tests ---

Deno.test('getGridItemLabel: returns filename for file field', () => {
  const field = createMockField({ fieldType: 'file' });
  const record = {
    testField: {
      key: 'a/b.jpg',
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    },
    id: 42,
  };
  assertEquals(getGridItemLabel(record, field, 'id'), 'photo.jpg');
});

Deno.test('getGridItemLabel: returns record ID when no file reference', () => {
  const field = createMockField({ fieldType: 'file' });
  const record = { test_field: null, id: 7 };
  assertEquals(getGridItemLabel(record, field, 'id'), '7');
});

Deno.test('getGridItemLabel: returns record ID for non-file field', () => {
  const field = createMockField({ fieldType: 'text' });
  const record = { testField: 'https://example.com/img.png', id: 99 };
  assertEquals(getGridItemLabel(record, field, 'id'), '99');
});

Deno.test('getGridItemLabel: returns empty string when no ID', () => {
  const field = createMockField({ fieldType: 'text' });
  const record = { testField: null };
  assertEquals(getGridItemLabel(record, field, 'id'), '');
});

Deno.test('gridView: no panel layout class when no panelData', () => {
  const thumbnails: GridThumbnail[] = [
    { id: 1, thumbnailUrl: 'https://example.com/a.jpg', label: 'Photo A' },
  ];
  const records = [{ id: 1, file: null }];
  const options = createGridOptions();

  const result = gridView('Media', records, thumbnails, options);
  assertEquals(result.includes('cms-grid-panel-layout'), false);
  assertEquals(result.includes('cms-grid-panel'), false);
});
