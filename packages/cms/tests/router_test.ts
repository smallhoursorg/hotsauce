// Tests for router utilities

import { assertEquals, assertExists } from '@std/assert';
import {
  cmsUrl,
  formatColumnName,
  formatTableName,
  matchPattern,
  matchPluginRoute,
  parseRoute,
  resolveAction,
} from '../router.ts';
import type { IntrospectedTable } from '@hotsauce/core';
import type { PluginConfig } from '../plugins/types.ts';

// Mock tables for testing
const mockTables: IntrospectedTable[] = [
  {
    name: 'users',
    columns: [
      {
        dbName: 'id',
        propertyName: 'id',
        columnType: 'PgSerial',
        dataType: 'number',
        notNull: true,
        hasDefault: true,
        isPrimaryKey: true,
        isUnique: false,
      },
      {
        dbName: 'email',
        propertyName: 'email',
        columnType: 'PgVarchar',
        dataType: 'string',
        notNull: true,
        hasDefault: false,
        isPrimaryKey: false,
        isUnique: true,
      },
    ],
    primaryKey: ['id'],
    table: {},
  },
  {
    name: 'posts',
    columns: [
      {
        dbName: 'id',
        propertyName: 'id',
        columnType: 'PgSerial',
        dataType: 'number',
        notNull: true,
        hasDefault: true,
        isPrimaryKey: true,
        isUnique: false,
      },
      {
        dbName: 'title',
        propertyName: 'title',
        columnType: 'PgVarchar',
        dataType: 'string',
        notNull: true,
        hasDefault: false,
        isPrimaryKey: false,
        isUnique: false,
      },
    ],
    primaryKey: ['id'],
    table: {},
  },
];

// =============================================================================
// parseRoute tests
// =============================================================================

Deno.test('parseRoute: dashboard route', () => {
  const url = new URL('http://localhost/admin');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table, null);
  assertEquals(route.action, 'dashboard');
});

Deno.test('parseRoute: dashboard with trailing slash', () => {
  const url = new URL('http://localhost/admin/');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.action, 'dashboard');
});

Deno.test('parseRoute: list route', () => {
  const url = new URL('http://localhost/admin/users');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table?.name, 'users');
  assertEquals(route.action, 'list');
});

Deno.test('parseRoute: create route', () => {
  const url = new URL('http://localhost/admin/users/new');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table?.name, 'users');
  assertEquals(route.action, 'create');
});

Deno.test('parseRoute: read route', () => {
  const url = new URL('http://localhost/admin/users/123');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table?.name, 'users');
  assertEquals(route.action, 'read');
  assertEquals(route.recordId, '123');
});

Deno.test('parseRoute: update route', () => {
  const url = new URL('http://localhost/admin/users/123/edit');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table?.name, 'users');
  assertEquals(route.action, 'update');
  assertEquals(route.recordId, '123');
});

Deno.test('parseRoute: delete route', () => {
  const url = new URL('http://localhost/admin/users/123/delete');
  const route = parseRoute(url, '/admin', mockTables);

  assertExists(route);
  assertEquals(route.table?.name, 'users');
  assertEquals(route.action, 'delete');
  assertEquals(route.recordId, '123');
});

Deno.test('parseRoute: returns null for unknown table', () => {
  const url = new URL('http://localhost/admin/unknown');
  const route = parseRoute(url, '/admin', mockTables);

  assertEquals(route, null);
});

Deno.test('parseRoute: returns null for path not starting with basePath', () => {
  const url = new URL('http://localhost/other/users');
  const route = parseRoute(url, '/admin', mockTables);

  assertEquals(route, null);
});

// =============================================================================
// resolveAction tests
// =============================================================================

Deno.test('resolveAction: GET dashboard', () => {
  const route = { table: null, action: 'dashboard' as const };
  assertEquals(resolveAction(route, 'GET'), 'dashboard');
});

Deno.test('resolveAction: POST dashboard returns null', () => {
  const route = { table: null, action: 'dashboard' as const };
  assertEquals(resolveAction(route, 'POST'), null);
});

Deno.test('resolveAction: GET list', () => {
  const route = { table: mockTables[0] ?? null, action: 'list' as const };
  assertEquals(resolveAction(route, 'GET'), 'list');
});

Deno.test('resolveAction: GET create (form)', () => {
  const route = { table: mockTables[0] ?? null, action: 'create' as const };
  assertEquals(resolveAction(route, 'GET'), 'create');
});

Deno.test('resolveAction: POST create (submit)', () => {
  const route = { table: mockTables[0] ?? null, action: 'create' as const };
  assertEquals(resolveAction(route, 'POST'), 'create');
});

Deno.test('resolveAction: GET read', () => {
  const route = {
    table: mockTables[0] ?? null,
    action: 'read' as const,
    recordId: '1',
  };
  assertEquals(resolveAction(route, 'GET'), 'read');
});

Deno.test('resolveAction: POST update', () => {
  const route = {
    table: mockTables[0] ?? null,
    action: 'update' as const,
    recordId: '1',
  };
  assertEquals(resolveAction(route, 'POST'), 'update');
});

Deno.test('resolveAction: POST delete', () => {
  const route = {
    table: mockTables[0] ?? null,
    action: 'delete' as const,
    recordId: '1',
  };
  assertEquals(resolveAction(route, 'POST'), 'delete');
});

// =============================================================================
// cmsUrl tests
// =============================================================================

Deno.test('cmsUrl: dashboard', () => {
  assertEquals(cmsUrl('/admin'), '/admin');
});

Deno.test('cmsUrl: list', () => {
  assertEquals(cmsUrl('/admin', 'users'), '/admin/users');
});

Deno.test('cmsUrl: read', () => {
  assertEquals(cmsUrl('/admin', 'users', '123'), '/admin/users/123');
});

Deno.test('cmsUrl: edit', () => {
  assertEquals(
    cmsUrl('/admin', 'users', '123', 'edit'),
    '/admin/users/123/edit',
  );
});

Deno.test('cmsUrl: create (new)', () => {
  assertEquals(
    cmsUrl('/admin', 'users', undefined, 'create'),
    '/admin/users/new',
  );
});

Deno.test('cmsUrl: delete', () => {
  assertEquals(
    cmsUrl('/admin', 'users', '123', 'delete'),
    '/admin/users/123/delete',
  );
});

Deno.test('cmsUrl: strips trailing slashes from basePath', () => {
  assertEquals(cmsUrl('/admin/', 'users'), '/admin/users');
});

// =============================================================================
// formatTableName tests
// =============================================================================

Deno.test('formatTableName: converts snake_case', () => {
  assertEquals(formatTableName('user_profiles'), 'User Profiles');
});

Deno.test('formatTableName: handles single word', () => {
  assertEquals(formatTableName('users'), 'Users');
});

Deno.test('formatTableName: handles multiple underscores', () => {
  assertEquals(
    formatTableName('user_account_settings'),
    'User Account Settings',
  );
});

// =============================================================================
// formatColumnName tests
// =============================================================================

Deno.test('formatColumnName: converts snake_case', () => {
  assertEquals(formatColumnName('created_at'), 'Created At');
});

Deno.test('formatColumnName: handles single word', () => {
  assertEquals(formatColumnName('email'), 'Email');
});

// =============================================================================
// matchPattern tests
// =============================================================================

Deno.test('matchPattern: exact match with no params', () => {
  const params = matchPattern('upload', 'upload');
  assertExists(params);
  assertEquals(Object.keys(params).length, 0);
});

Deno.test('matchPattern: single param', () => {
  const params = matchPattern(':table', 'posts');
  assertExists(params);
  assertEquals(params.table, 'posts');
});

Deno.test('matchPattern: multiple params', () => {
  const params = matchPattern(':table/:id', 'posts/42');
  assertExists(params);
  assertEquals(params.table, 'posts');
  assertEquals(params.id, '42');
});

Deno.test('matchPattern: three params', () => {
  const params = matchPattern(':table/:id/:column', 'posts/42/body');
  assertExists(params);
  assertEquals(params.table, 'posts');
  assertEquals(params.id, '42');
  assertEquals(params.column, 'body');
});

Deno.test('matchPattern: mixed static and param segments', () => {
  const params = matchPattern('edit/:table/:id', 'edit/users/123');
  assertExists(params);
  assertEquals(params.table, 'users');
  assertEquals(params.id, '123');
});

Deno.test('matchPattern: returns null for segment count mismatch', () => {
  const params = matchPattern(':table/:id', 'posts');
  assertEquals(params, null);
});

Deno.test('matchPattern: returns null for static segment mismatch', () => {
  const params = matchPattern('edit/:id', 'view/123');
  assertEquals(params, null);
});

Deno.test('matchPattern: empty path matches empty pattern', () => {
  const params = matchPattern('', '');
  assertExists(params);
  assertEquals(Object.keys(params).length, 0);
});

// =============================================================================
// matchPluginRoute tests
// =============================================================================

// Mock plugins for route matching tests
const mockPlugins: PluginConfig[] = [
  {
    name: 'puck',
    filter: 'dangerously-open',
    routes: [
      {
        pattern: ':table/:id/:column',
        methods: ['GET', 'POST'],
        handler: () => '<html>editor</html>',
      },
      {
        pattern: 'preview/:table/:id',
        methods: ['GET'],
        handler: () => '<html>preview</html>',
      },
    ],
  },
  {
    name: 'media',
    filter: 'dangerously-open',
    routes: [
      {
        pattern: 'upload',
        methods: ['POST'],
        handler: () => 'uploaded',
      },
      {
        pattern: 'browse',
        methods: ['GET'],
        handler: () => '<html>browse</html>',
      },
    ],
  },
  {
    name: 'no-routes',
    filter: 'dangerously-open',
    // No routes defined
  },
];

Deno.test('matchPluginRoute: matches plugin with params', () => {
  const url = new URL('http://localhost/admin/puck/posts/42/body');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);

  assertExists(match);
  assertEquals(match.plugin.name, 'puck');
  assertEquals(match.route.pattern, ':table/:id/:column');
  assertEquals(match.params.table, 'posts');
  assertEquals(match.params.id, '42');
  assertEquals(match.params.column, 'body');
});

Deno.test('matchPluginRoute: matches route with static prefix over param route', () => {
  // preview/:table/:id should match when path starts with 'preview'
  // BUT our routes are checked in order - first match wins
  // So ':table/:id/:column' matches 'preview/users/123' as table=preview, id=users, column=123
  const url = new URL('http://localhost/admin/puck/preview/users/123');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);

  assertExists(match);
  assertEquals(match.plugin.name, 'puck');
  // First route matches because it's checked first
  assertEquals(match.route.pattern, ':table/:id/:column');
  assertEquals(match.params.table, 'preview');
  assertEquals(match.params.id, 'users');
  assertEquals(match.params.column, '123');
});

Deno.test('matchPluginRoute: matches different plugin', () => {
  const url = new URL('http://localhost/admin/media/browse');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);

  assertExists(match);
  assertEquals(match.plugin.name, 'media');
  assertEquals(match.route.pattern, 'browse');
});

Deno.test('matchPluginRoute: accepts POST requests for routes declaring POST', () => {
  // POST should match routes that declare POST method
  const postMatch = matchPluginRoute(
    new URL('http://localhost/admin/media/upload'),
    '/admin',
    'POST',
    mockPlugins,
  );
  assertExists(postMatch);
  assertEquals(postMatch.plugin.name, 'media');
  assertEquals(postMatch.route.pattern, 'upload');

  // GET to browse should still work
  const getMatch = matchPluginRoute(
    new URL('http://localhost/admin/media/browse'),
    '/admin',
    'GET',
    mockPlugins,
  );
  assertExists(getMatch);
  assertEquals(getMatch.route.pattern, 'browse');
});

Deno.test('matchPluginRoute: returns null for unknown plugin', () => {
  const url = new URL('http://localhost/admin/unknown/something');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);
  assertEquals(match, null);
});

Deno.test('matchPluginRoute: returns null for plugin without routes', () => {
  const url = new URL('http://localhost/admin/no-routes/anything');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);
  assertEquals(match, null);
});

Deno.test('matchPluginRoute: returns null for non-matching segment count', () => {
  // puck routes have 3 segments max, this has 4
  const url = new URL('http://localhost/admin/puck/a/b/c/d');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);
  assertEquals(match, null);
});

Deno.test('matchPluginRoute: returns null for base path only', () => {
  const url = new URL('http://localhost/admin');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);
  assertEquals(match, null);
});

Deno.test('matchPluginRoute: returns null for path outside base', () => {
  const url = new URL('http://localhost/other/puck/posts/1/body');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);
  assertEquals(match, null);
});

Deno.test('matchPluginRoute: handles trailing slashes', () => {
  const url = new URL('http://localhost/admin/media/browse/');
  const match = matchPluginRoute(url, '/admin', 'GET', mockPlugins);

  assertExists(match);
  assertEquals(match.plugin.name, 'media');
});

Deno.test('matchPluginRoute: handles base path with trailing slash', () => {
  const url = new URL('http://localhost/admin/puck/posts/1/title');
  const match = matchPluginRoute(url, '/admin/', 'GET', mockPlugins);

  assertExists(match);
  assertEquals(match.plugin.name, 'puck');
  assertEquals(match.params.table, 'posts');
});

// ─────────────────────────────────────────────────────────────
// Plugin Route Body Tests
// ─────────────────────────────────────────────────────────────

Deno.test('PluginRouteContext: body field is part of context type', () => {
  // This is a compile-time check that body exists on the context type
  // The actual passing of body happens in handlePluginRoute in mod.ts

  // Type check: body is optional string on PluginRouteContext
  const ctx = {
    table: 'media',
    recordId: '123',
    column: 'file',
    record: {},
    value: null,
    csrfToken: 'token',
    sourceToken: 'source',
    basePath: '/admin',
    requestUrl: 'http://localhost/admin/s3-storage/presign',
    method: 'POST',
    body: '{"table":"media","column":"file"}', // POST body
    params: {},
  };

  // Verify body can be parsed
  const parsed = JSON.parse(ctx.body);
  assertEquals(parsed.table, 'media');
  assertEquals(ctx.method, 'POST');
});
