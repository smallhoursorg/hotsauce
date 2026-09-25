// Tests for the main handler

import { assertEquals } from '@std/assert';
import { createCmsHandler } from '../mod.ts';
import type { IntrospectedSchema, IntrospectedTable } from '@hotsauce/core';

// Test CSRF secret
const TEST_CSRF_SECRET = 'test-csrf-secret-for-handler-tests-min-32-chars';

// Mock schema for testing
const mockTable: IntrospectedTable = {
  name: 'users',
  columns: [
    {
      name: 'id',
      propertyName: 'id',
      columnType: 'PgSerial',
      dataType: 'number',
      notNull: true,
      hasDefault: true,
      isPrimaryKey: true,
      isUnique: false,
    },
    {
      name: 'email',
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
};

const mockPostsTable: IntrospectedTable = {
  name: 'posts',
  columns: [
    {
      name: 'id',
      propertyName: 'id',
      columnType: 'PgSerial',
      dataType: 'number',
      notNull: true,
      hasDefault: true,
      isPrimaryKey: true,
      isUnique: false,
    },
    {
      name: 'title',
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
};

const mockSchema: IntrospectedSchema = {
  tables: [mockTable, mockPostsTable],
  relations: [],
  junctions: [],
};

// Mock database
const mockDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve([]) }),
      limit: () => ({ offset: () => Promise.resolve([]) }),
    }),
  }),
  insert: () => ({
    values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  delete: () => ({ where: () => Promise.resolve() }),
};

// =============================================================================
// createCmsHandler tests
// =============================================================================

Deno.test('createCmsHandler: returns a function', () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
  });

  assertEquals(typeof handler, 'function');
});

Deno.test('createCmsHandler: 404 for unknown routes', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
  });

  const request = new Request('http://localhost/other');
  const response = await handler(request);

  assertEquals(response.status, 404);
});

Deno.test('createCmsHandler: 403 when not authenticated', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => false,
  });

  const request = new Request('http://localhost/admin');
  const response = await handler(request);

  assertEquals(response.status, 403);
});

Deno.test('createCmsHandler: renders dashboard on GET /admin', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
  });

  const request = new Request('http://localhost/admin');
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get('Content-Type'),
    'text/html; charset=utf-8',
  );

  const html = await response.text();
  assertEquals(html.includes('Dashboard'), true);
});

Deno.test('createCmsHandler: 405 for POST on dashboard', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
  });

  const request = new Request('http://localhost/admin', { method: 'POST' });
  const response = await handler(request);

  assertEquals(response.status, 405);
});

Deno.test('createCmsHandler: custom title appears in dashboard', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    title: 'My CMS',
  });

  const request = new Request('http://localhost/admin');
  const response = await handler(request);
  const html = await response.text();

  assertEquals(html.includes('My CMS'), true);
});

Deno.test('createCmsHandler: async authentication check', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return true;
    },
  });

  const request = new Request('http://localhost/admin');
  const response = await handler(request);

  assertEquals(response.status, 200);
});

Deno.test('createCmsHandler: onError callback is called on database error', async () => {
  let capturedError: Error | undefined;
  let capturedContext: unknown;

  // Mock db that throws on select
  const throwingDb = {
    select: () => ({
      from: () => {
        throw new Error('Database connection failed');
      },
    }),
  };

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: throwingDb,
    basePath: '/admin',
    onError: (error, context) => {
      capturedError = error;
      capturedContext = context;
    },
  });

  const request = new Request('http://localhost/admin/users');
  const response = await handler(request);

  // Should return 500
  assertEquals(response.status, 500);

  // onError should have been called
  assertEquals(capturedError !== undefined, true);
  assertEquals(capturedError!.message, 'Database connection failed');

  // Context should include request info
  assertEquals((capturedContext as { action: string }).action, 'list');
});

Deno.test('createCmsHandler: onError handles non-Error throws', async () => {
  let capturedError: Error | undefined;

  // Mock db that throws a string (not an Error)
  const throwingDb = {
    select: () => ({
      from: () => {
        throw 'string error'; // Non-Error throw
      },
    }),
  };

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: throwingDb,
    basePath: '/admin',
    onError: (error) => {
      capturedError = error;
    },
  });

  const request = new Request('http://localhost/admin/users');
  const response = await handler(request);

  assertEquals(response.status, 500);
  assertEquals(capturedError instanceof Error, true);
  assertEquals(capturedError!.message, 'string error');
});

// =============================================================================
// Plugin Route Auth Tests
// =============================================================================

Deno.test('createCmsHandler: plugin routes require authentication', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => false, // User is NOT authenticated
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'action',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/test-plugin/action');
  const response = await handler(request);

  assertEquals(response.status, 403);
  assertEquals(
    handlerCalled,
    false,
    'Handler should NOT be called when unauthenticated',
  );
});

Deno.test('createCmsHandler: plugin routes allow authenticated users', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true, // User IS authenticated
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'action',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/test-plugin/action');
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(
    handlerCalled,
    true,
    'Handler should be called when authenticated',
  );
});

Deno.test('createCmsHandler: plugin POST routes work with valid CSRF', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'submit',
            methods: ['POST'],
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  // Generate a valid CSRF token
  const { generateCsrfToken } = await import('../csrf.ts');
  const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);

  const formData = new FormData();
  formData.append('data', 'test');
  formData.append('__cms_csrf', csrfToken);

  const request = new Request('http://localhost/admin/test-plugin/submit', {
    method: 'POST',
    body: formData,
  });
  const response = await handler(request);

  // POST to plugin routes now works with valid CSRF
  assertEquals(response.status, 200);
  assertEquals(
    handlerCalled,
    true,
    'Handler should be called for POST with valid CSRF',
  );
});

Deno.test('createCmsHandler: plugin routes work without auth config', async () => {
  let handlerCalled = false;

  // No isAuthenticated configured = open access
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'action',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/test-plugin/action');
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(handlerCalled, true);
});

Deno.test('createCmsHandler: plugin routes with async isAuthenticated', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return false; // Async check returns not authenticated
    },
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'action',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/test-plugin/action');
  const response = await handler(request);

  assertEquals(response.status, 403);
  assertEquals(handlerCalled, false);
});

// =============================================================================
// Plugin Route Filter Security Tests
// =============================================================================

Deno.test('createCmsHandler: plugin route filter blocks access to filtered tables', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'editor',
        hooks: {},
        // Filter blocks routes to 'users' table
        filter: (ctx) => ctx.table !== 'users',
        routes: [
          {
            pattern: ':table/:id',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  // Attempt to access users table via plugin route
  const request = new Request('http://localhost/admin/editor/users/123');
  const response = await handler(request);

  assertEquals(response.status, 403);
  assertEquals(
    handlerCalled,
    false,
    'Handler should NOT be called when filter blocks the table',
  );
});

Deno.test('createCmsHandler: plugin route filter allows unfiltered tables', async () => {
  let handlerCalled = false;
  let capturedTable: string | undefined;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'editor',
        hooks: {},
        // Filter blocks only 'users' table
        filter: (ctx) => ctx.table !== 'users',
        routes: [
          {
            // Use a pattern that captures table but doesn't trigger record fetch
            // (no :id means table/recordId won't both be present)
            pattern: 'browse/:table',
            handler: (ctx) => {
              handlerCalled = true;
              capturedTable = ctx.params.table;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  // Access posts table (not blocked by filter)
  const request = new Request('http://localhost/admin/editor/browse/posts');
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(handlerCalled, true);
  assertEquals(capturedTable, 'posts');
});

Deno.test('createCmsHandler: plugin route filter receives correct hookType', async () => {
  let capturedHookType: string | undefined;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: (ctx) => {
          capturedHookType = ctx.hookType;
          return true;
        },
        routes: [
          {
            pattern: 'action',
            handler: () => new Response('OK'),
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/test-plugin/action');
  await handler(request);

  assertEquals(capturedHookType, 'route');
});

Deno.test('createCmsHandler: plugin route filter receives correct action for GET', async () => {
  let capturedAction: string | undefined;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: (ctx) => {
          capturedAction = ctx.action;
          return true;
        },
        routes: [
          {
            pattern: 'action',
            handler: () => new Response('OK'),
          },
        ],
      },
    ],
  });

  // GET request should have action 'read'
  const getRequest = new Request('http://localhost/admin/test-plugin/action');
  await handler(getRequest);
  assertEquals(capturedAction, 'read');
});

Deno.test('createCmsHandler: plugin route dangerously-open filter allows all', async () => {
  let handlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'editor',
        hooks: {},
        filter: 'dangerously-open', // Explicit opt-in to all data
        routes: [
          {
            // Use pattern that doesn't trigger record fetch
            pattern: 'browse/:table',
            handler: () => {
              handlerCalled = true;
              return new Response('OK');
            },
          },
        ],
      },
    ],
  });

  // Should allow access with dangerously-open
  const request = new Request('http://localhost/admin/editor/browse/users');
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(handlerCalled, true);
});

Deno.test('createCmsHandler: plugin route filter receives user context', async () => {
  let capturedUser: { sub: string; role?: string } | undefined;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        name: 'test-plugin',
        hooks: {},
        filter: (ctx) => {
          capturedUser = ctx.user;
          // Simulate role-based filtering
          return ctx.user?.role === 'admin';
        },
        routes: [
          {
            pattern: 'action',
            handler: () => new Response('OK'),
          },
        ],
      },
    ],
  });

  // Without JWT auth, user context won't have role - filter should reject
  const request = new Request('http://localhost/admin/test-plugin/action');
  const response = await handler(request);

  assertEquals(response.status, 403);
  assertEquals(capturedUser, undefined);
});

Deno.test('createCmsHandler: plugin route handler errors are caught and reported', async () => {
  let capturedError: Error | undefined;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    onError: (error) => {
      capturedError = error;
    },
    plugins: [
      {
        name: 'buggy-plugin',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: 'crash',
            handler: () => {
              throw new Error('Plugin route crashed!');
            },
          },
        ],
      },
    ],
  });

  const request = new Request('http://localhost/admin/buggy-plugin/crash');
  const response = await handler(request);

  // Should return 500, not crash
  assertEquals(response.status, 500);
  // Error should be reported via onError
  assertEquals(capturedError?.message, 'Plugin route crashed!');
});

Deno.test('createCmsHandler: built-in routes take precedence over plugin routes', async () => {
  let pluginHandlerCalled = false;

  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
    plugins: [
      {
        // Plugin named same as a table - should NOT shadow CRUD routes
        name: 'users',
        hooks: {},
        filter: 'dangerously-open',
        routes: [
          {
            pattern: ':id',
            handler: () => {
              pluginHandlerCalled = true;
              return new Response('Plugin hijacked!');
            },
          },
        ],
      },
    ],
  });

  // /admin/users/123 should go to built-in CRUD, not plugin
  const request = new Request('http://localhost/admin/users/123');
  const response = await handler(request);

  // Built-in route returns HTML for record view (or 404 if record not found)
  // The key assertion is that plugin handler was NOT called
  assertEquals(
    pluginHandlerCalled,
    false,
    'Plugin should NOT shadow built-in table routes',
  );
  // Response should be from built-in handler (HTML content type)
  assertEquals(
    response.headers.get('Content-Type')?.includes('text/html'),
    true,
  );
});

Deno.test('createCmsHandler: plugin returning fileUrl: undefined calls console.error', async () => {
  // Track console.error calls
  const consoleErrors: Array<{ args: unknown[] }> = [];
  // deno-lint-ignore no-console
  const originalError = console.error;
  // deno-lint-ignore no-console
  console.error = (...args: unknown[]) => {
    consoleErrors.push({ args });
  };

  try {
    // Create a schema with a column that has plugins config
    // This ensures renderField is called for this column
    const tableWithPlugins: IntrospectedTable = {
      name: 'content',
      columns: [
        {
          name: 'id',
          propertyName: 'id',
          columnType: 'PgSerial',
          dataType: 'number',
          notNull: true,
          hasDefault: true,
          isPrimaryKey: true,
          isUnique: false,
        },
        {
          name: 'body',
          propertyName: 'body',
          columnType: 'PgJsonb',
          dataType: 'json',
          notNull: false,
          hasDefault: false,
          isPrimaryKey: false,
          isUnique: false,
          // This makes renderField get called for this column
          cmsOptions: {
            plugins: { 'bad-fileurl-plugin': true },
          },
        },
      ],
      primaryKey: ['id'],
      table: {},
    };

    const schemaWithPlugins: IntrospectedSchema = {
      tables: [tableWithPlugins],
      relations: [],
      junctions: [],
    };

    // Mock db that returns a record for edit view
    const mockDbWithRecord = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: 1, body: { blocks: [] } }]),
          }),
          limit: () => ({ offset: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      delete: () => ({ where: () => Promise.resolve() }),
    };

    // Create a plugin that returns invalid data: fileUrl: undefined
    // This was a real bug - the validation rejects explicit undefined values
    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      schema: schemaWithPlugins,
      db: mockDbWithRecord,
      basePath: '/admin',
      isAuthenticated: () => true,
      plugins: [
        {
          name: 'bad-fileurl-plugin',
          filter: 'dangerously-open',
          hooks: {
            ui: {
              // This returns invalid data - fileUrl must be string or omitted, not undefined
              renderField: () => ({
                valueSummary: 'Test file',
                fileUrl: undefined,
              }),
            },
          },
        },
      ],
    });

    // Request the edit page - this triggers renderField for columns with plugins config
    const request = new Request('http://localhost/admin/content/1/edit');
    await handler(request);

    // console.error should have been called with plugin error message
    assertEquals(
      consoleErrors.length >= 1,
      true,
      'console.error should be called',
    );
    const errorCall = consoleErrors.find((e) =>
      typeof e.args[0] === 'string' &&
      e.args[0].includes('[CMS Plugin Error]') &&
      e.args[0].includes('bad-fileurl-plugin')
    );
    assertEquals(
      errorCall !== undefined,
      true,
      'console.error should include [CMS Plugin Error] prefix and plugin name',
    );
  } finally {
    // Restore console.error
    // deno-lint-ignore no-console
    console.error = originalError;
  }
});

Deno.test('createCmsHandler: /files/ route is blocked when isAuthenticated returns false', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => false,
  });

  for (
    const path of [
      '/admin/files/users/avatar/1',
      '/admin/files/users/avatar/1/photo.png',
    ]
  ) {
    const response = await handler(new Request(`http://localhost${path}`));
    assertEquals(response.status, 403, `${path} should be forbidden`);
  }
});

Deno.test('createCmsHandler: /files/ route reaches file serving when isAuthenticated returns true', async () => {
  const handler = createCmsHandler({
    csrfSecret: TEST_CSRF_SECRET,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
    schema: mockSchema,
    db: mockDb,
    basePath: '/admin',
    isAuthenticated: () => true,
  });

  // mockSchema has no file columns, so the handler gets past the auth gate
  // and 404s on the column lookup rather than 403ing.
  const response = await handler(
    new Request('http://localhost/admin/files/users/avatar/1'),
  );
  assertEquals(response.status, 404);
});
