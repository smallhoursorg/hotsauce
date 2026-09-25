// Tests for CMS configuration validation

import { assertEquals, assertThrows } from '@std/assert';
import {
  CmsConfigError,
  CmsOptionsSchema,
  validateAutoDraft,
  validateCmsOptions,
  validateCspOptions,
  validateThumbnailColumns,
} from '../validation.ts';

// Mock minimal valid options
const validOptions = {
  db: { query: () => {} },
  schema: { users: { name: 'users' } },
  auth: 'dangerously-open' as const,
  policies: 'dangerously-open' as const,
};

Deno.test('validateCmsOptions: accepts valid config', () => {
  // Should not throw
  validateCmsOptions(validOptions);
});

Deno.test('validateCmsOptions: throws CmsConfigError on invalid config', () => {
  assertThrows(
    () => validateCmsOptions({}),
    CmsConfigError,
    'Invalid CMS configuration',
  );
});

Deno.test('validateCmsOptions: requires db', () => {
  assertThrows(
    () =>
      validateCmsOptions({
        schema: { users: {} },
        auth: 'dangerously-open',
        policies: 'dangerously-open',
      }),
    CmsConfigError,
    'db is required',
  );
});

Deno.test('validateCmsOptions: requires schema with tables', () => {
  assertThrows(
    () =>
      validateCmsOptions({
        db: {},
        schema: {},
        auth: 'dangerously-open',
        policies: 'dangerously-open',
      }),
    CmsConfigError,
    'at least one table',
  );
});

Deno.test('validateCmsOptions: validates basePath starts with /', () => {
  assertThrows(
    () => validateCmsOptions({ ...validOptions, basePath: 'admin' }),
    CmsConfigError,
    'basePath must start with /',
  );
});

Deno.test('validateCmsOptions: requires auth property', () => {
  const { auth: _, ...optionsWithoutAuth } = validOptions;
  assertThrows(
    () => validateCmsOptions(optionsWithoutAuth),
    CmsConfigError,
    'Invalid CMS configuration',
  );
});

Deno.test("validateCmsOptions: accepts auth: 'dangerously-open'", () => {
  // Should not throw
  validateCmsOptions({
    ...validOptions,
    auth: 'dangerously-open',
    policies: 'dangerously-open',
  });
});

Deno.test('validateCmsOptions: accepts auth config object with policies at top level', () => {
  // Should not throw - policies required at top level now
  validateCmsOptions({
    ...validOptions,
    auth: {
      provider: { authenticate: () => {} },
    },
    policies: { users: () => undefined },
  });
});

Deno.test("validateCmsOptions: accepts policies: 'dangerously-open'", () => {
  // Should not throw
  validateCmsOptions({
    ...validOptions,
    auth: {
      provider: { authenticate: () => {} },
    },
    policies: 'dangerously-open',
  });
});

Deno.test('validateCmsOptions: requires policies at top level', () => {
  assertThrows(
    () =>
      validateCmsOptions({
        db: { query: () => {} },
        schema: { users: { name: 'users' } },
        auth: {
          provider: { authenticate: () => {} },
        },
        // policies missing
      }),
    CmsConfigError,
    'policies',
  );
});

Deno.test('validateCmsOptions: accepts empty policies object (full access)', () => {
  // Empty policies {} is equivalent to 'dangerously-open' - full access to all tables
  validateCmsOptions({
    ...validOptions,
    auth: {
      provider: { authenticate: () => {} },
    },
    policies: {},
  });
});

Deno.test('validateCmsOptions: validates auth.provider is required', () => {
  assertThrows(
    () =>
      validateCmsOptions({
        ...validOptions,
        auth: {} as { provider: unknown },
        policies: 'dangerously-open',
      }),
    CmsConfigError,
    'auth.provider must be an AuthProvider',
  );
});

Deno.test('validateCmsOptions: validates auth.secret length', () => {
  assertThrows(
    () =>
      validateCmsOptions({
        ...validOptions,
        auth: {
          provider: { authenticate: () => {} },
          secret: 'short',
        },
        policies: 'dangerously-open',
      }),
    CmsConfigError,
    'at least 32 characters',
  );
});

Deno.test('validateCmsOptions: validates csrfSecret length', () => {
  assertThrows(
    () => validateCmsOptions({ ...validOptions, csrfSecret: 'short' }),
    CmsConfigError,
    'at least 32 characters',
  );
});

Deno.test('validateCmsOptions: accepts valid csrfSecret', () => {
  // Should not throw
  validateCmsOptions({
    ...validOptions,
    csrfSecret: 'this-is-a-secret-that-is-at-least-32-characters-long',
  });
});

Deno.test('validateCmsOptions: handles Symbol keys in error paths', () => {
  // Drizzle tables have Symbol properties that Zod may include in error paths
  // This test ensures we don't crash when formatting error messages
  const symbolKey = Symbol('drizzle:test');
  const schemaWithSymbol = {
    users: { [symbolKey]: 'value' },
  };

  // This should throw CmsConfigError, not TypeError about Symbol conversion
  try {
    validateCmsOptions({
      db: null, // Invalid - will trigger error
      schema: schemaWithSymbol,
    });
  } catch (error) {
    // Should be CmsConfigError, not TypeError
    assertEquals(error instanceof CmsConfigError, true);
    assertEquals(
      (error as CmsConfigError).message.includes('Invalid CMS configuration'),
      true,
    );
  }
});

Deno.test('CmsOptionsSchema: parses valid options', () => {
  const result = CmsOptionsSchema.safeParse(validOptions);
  assertEquals(result.success, true);
});

Deno.test('CmsConfigError: includes ZodError details', () => {
  try {
    validateCmsOptions({});
  } catch (error) {
    const configError = error as CmsConfigError;
    assertEquals(configError.name, 'CmsConfigError');
    assertEquals(configError.details !== undefined, true);
  }
});

// =============================================================================
// validateFileColumnsAndConfigs tests
// =============================================================================

import { validateFileColumnsAndConfigs } from '../validation.ts';

Deno.test('validateFileColumnsAndConfigs: accepts file columns with json dataType', () => {
  const introspected = {
    tables: [
      {
        name: 'users',
        columns: [
          {
            propertyName: 'avatar',
            dataType: 'json',
            cmsOptions: { file: true },
          },
        ],
      },
    ],
  };
  // Should not throw
  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: accepts file.previewSvg boolean on json columns', () => {
  const introspected = {
    tables: [
      {
        name: 'assets',
        columns: [
          {
            propertyName: 'icon',
            dataType: 'json',
            cmsOptions: { file: { previewSvg: true } },
          },
        ],
      },
    ],
  };

  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: rejects non-boolean file.previewSvg', () => {
  const introspected = {
    tables: [
      {
        name: 'assets',
        columns: [
          {
            propertyName: 'icon',
            dataType: 'json',
            cmsOptions: {
              file: { previewSvg: 'yes' as unknown as boolean },
            },
          },
        ],
      },
    ],
  };

  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'file.previewSvg must be a boolean',
  );
});

Deno.test('validateFileColumnsAndConfigs: accepts valid file.accept string', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'document',
            dataType: 'json',
            cmsOptions: { file: { accept: 'application/pdf,.doc,.docx' } },
          },
        ],
      },
    ],
  };

  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: rejects non-string file.accept', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'document',
            dataType: 'json',
            cmsOptions: {
              file: { accept: ['image/*'] as unknown as string },
            },
          },
        ],
      },
    ],
  };

  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'file.accept must be a string',
  );
});

Deno.test('validateFileColumnsAndConfigs: accepts valid file.maxSize number', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'photo',
            dataType: 'json',
            cmsOptions: { file: { maxSize: 5_000_000 } },
          },
        ],
      },
    ],
  };

  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: accepts file.maxSize of 0', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'photo',
            dataType: 'json',
            cmsOptions: { file: { maxSize: 0 } },
          },
        ],
      },
    ],
  };

  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: rejects non-number file.maxSize', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'document',
            dataType: 'json',
            cmsOptions: {
              file: { maxSize: '5MB' as unknown as number },
            },
          },
        ],
      },
    ],
  };

  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'file.maxSize must be a non-negative number',
  );
});

Deno.test('validateFileColumnsAndConfigs: rejects negative file.maxSize', () => {
  const introspected = {
    tables: [
      {
        name: 'uploads',
        columns: [
          {
            propertyName: 'document',
            dataType: 'json',
            cmsOptions: { file: { maxSize: -100 } },
          },
        ],
      },
    ],
  };

  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'file.maxSize must be a non-negative number',
  );
});

Deno.test('validateFileColumnsAndConfigs: accepts tables without file columns', () => {
  const introspected = {
    tables: [
      {
        name: 'users',
        columns: [
          { propertyName: 'name', dataType: 'string' },
          { propertyName: 'email', dataType: 'string' },
        ],
      },
    ],
  };
  // Should not throw
  validateFileColumnsAndConfigs(introspected);
});

Deno.test('validateFileColumnsAndConfigs: rejects file column with string dataType', () => {
  const introspected = {
    tables: [
      {
        name: 'users',
        columns: [
          {
            propertyName: 'avatar',
            dataType: 'string',
            cmsOptions: { file: true },
          },
        ],
      },
    ],
  };
  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'users.avatar',
  );
});

Deno.test('validateFileColumnsAndConfigs: rejects file column with number dataType', () => {
  const introspected = {
    tables: [
      {
        name: 'posts',
        columns: [
          {
            propertyName: 'image',
            dataType: 'number',
            cmsOptions: { file: true },
          },
        ],
      },
    ],
  };
  assertThrows(
    () => validateFileColumnsAndConfigs(introspected),
    CmsConfigError,
    'posts.image',
  );
});

Deno.test('validateFileColumnsAndConfigs: reports multiple errors', () => {
  const introspected = {
    tables: [
      {
        name: 'users',
        columns: [
          {
            propertyName: 'avatar',
            dataType: 'string',
            cmsOptions: { file: true },
          },
        ],
      },
      {
        name: 'posts',
        columns: [
          {
            propertyName: 'image',
            dataType: 'string',
            cmsOptions: { file: true },
          },
        ],
      },
    ],
  };
  try {
    validateFileColumnsAndConfigs(introspected);
  } catch (error) {
    const message = (error as CmsConfigError).message;
    assertEquals(message.includes('users.avatar'), true);
    assertEquals(message.includes('posts.image'), true);
  }
});

// =============================================================================
// CSP validation tests
// =============================================================================

Deno.test('validateCspOptions: accepts valid https origins', () => {
  validateCspOptions({
    imgSrc: ['https://s3.amazonaws.com', 'https://cdn.example.com:8443'],
  });
});

Deno.test('validateCspOptions: accepts valid http origins', () => {
  validateCspOptions({
    imgSrc: ['http://localhost:9000'],
  });
});

Deno.test('validateCspOptions: accepts empty arrays', () => {
  validateCspOptions({ imgSrc: [], connectSrc: [], frameSrc: [] });
});

Deno.test('validateCspOptions: accepts undefined directives', () => {
  validateCspOptions({});
});

Deno.test('validateCspOptions: rejects non-URL strings', () => {
  assertThrows(
    () => validateCspOptions({ imgSrc: ['not-a-url'] }),
    CmsConfigError,
    'not a valid URL origin',
  );
});

Deno.test('validateCspOptions: rejects javascript: scheme', () => {
  assertThrows(
    () => validateCspOptions({ imgSrc: ['javascript:alert(1)'] }),
    CmsConfigError,
    'http: or https:',
  );
});

Deno.test('validateCspOptions: rejects data: scheme', () => {
  assertThrows(
    () => validateCspOptions({ imgSrc: ['data:text/html,<h1>hi</h1>'] }),
    CmsConfigError,
    'http: or https:',
  );
});

Deno.test('validateCspOptions: rejects ftp: scheme', () => {
  assertThrows(
    () => validateCspOptions({ connectSrc: ['ftp://files.example.com'] }),
    CmsConfigError,
    'http: or https:',
  );
});

Deno.test('validateCspOptions: rejects URLs with paths', () => {
  assertThrows(
    () => validateCspOptions({ imgSrc: ['https://s3.example.com/bucket'] }),
    CmsConfigError,
    'not a full URL with path',
  );
});

Deno.test('validateCspOptions: rejects URLs with query strings', () => {
  assertThrows(
    () => validateCspOptions({ imgSrc: ['https://s3.example.com?key=val'] }),
    CmsConfigError,
    'not a full URL with path',
  );
});

Deno.test('validateCspOptions: reports errors for multiple directives', () => {
  try {
    validateCspOptions({
      imgSrc: ['not-valid'],
      frameSrc: ['also-not-valid'],
    });
  } catch (error) {
    const message = (error as CmsConfigError).message;
    assertEquals(message.includes('csp.imgSrc'), true);
    assertEquals(message.includes('csp.frameSrc'), true);
  }
});

// =============================================================================
// CSP styleSrc validation tests
// =============================================================================

Deno.test("validateCspOptions: accepts 'unsafe-inline' in styleSrc", () => {
  validateCspOptions({ styleSrc: ["'unsafe-inline'"] });
});

Deno.test("validateCspOptions: accepts 'unsafe-hashes' in styleSrc", () => {
  validateCspOptions({ styleSrc: ["'unsafe-hashes'"] });
});

Deno.test('validateCspOptions: accepts hash source in styleSrc', () => {
  validateCspOptions({
    styleSrc: ["'sha256-abc123+/='"],
  });
});

Deno.test('validateCspOptions: accepts nonce source in styleSrc', () => {
  validateCspOptions({
    styleSrc: ["'nonce-abc123'"],
  });
});

Deno.test('validateCspOptions: accepts URL origin in styleSrc', () => {
  validateCspOptions({
    styleSrc: ['https://fonts.googleapis.com'],
  });
});

Deno.test("validateCspOptions: rejects 'unsafe-eval' in styleSrc", () => {
  assertThrows(
    () => validateCspOptions({ styleSrc: ["'unsafe-eval'"] }),
    CmsConfigError,
    'unsafe-eval',
  );
});

Deno.test('validateCspOptions: rejects unrecognized CSP keyword in styleSrc', () => {
  assertThrows(
    () => validateCspOptions({ styleSrc: ["'bad-keyword'"] }),
    CmsConfigError,
    'not a recognized CSP source',
  );
});

Deno.test('validateCspOptions: accepts empty styleSrc array', () => {
  validateCspOptions({ styleSrc: [] });
});

// =============================================================================
// validateThumbnailColumns tests
// =============================================================================

Deno.test('validateThumbnailColumns: accepts table with single thumbnail column', () => {
  const introspected = {
    tables: [{
      name: 'media',
      columns: [
        { propertyName: 'id' },
        { propertyName: 'file', cmsOptions: { thumbnail: true } },
        { propertyName: 'title' },
      ],
    }],
  };
  validateThumbnailColumns(introspected); // Should not throw
});

Deno.test('validateThumbnailColumns: accepts table with no thumbnail columns', () => {
  const introspected = {
    tables: [{
      name: 'posts',
      columns: [
        { propertyName: 'id' },
        { propertyName: 'title' },
        { propertyName: 'body' },
      ],
    }],
  };
  validateThumbnailColumns(introspected); // Should not throw
});

Deno.test('validateThumbnailColumns: rejects table with multiple thumbnail columns', () => {
  const introspected = {
    tables: [{
      name: 'media',
      columns: [
        { propertyName: 'id' },
        { propertyName: 'file', cmsOptions: { thumbnail: true } },
        { propertyName: 'preview', cmsOptions: { thumbnail: true } },
      ],
    }],
  };
  assertThrows(
    () => validateThumbnailColumns(introspected),
    CmsConfigError,
    'multiple thumbnail columns',
  );
});

Deno.test('validateThumbnailColumns: reports column names in error', () => {
  const introspected = {
    tables: [{
      name: 'media',
      columns: [
        { propertyName: 'id' },
        { propertyName: 'file', cmsOptions: { thumbnail: true } },
        { propertyName: 'preview', cmsOptions: { thumbnail: true } },
      ],
    }],
  };
  try {
    validateThumbnailColumns(introspected);
    throw new Error('Expected to throw');
  } catch (error) {
    const message = (error as CmsConfigError).message;
    assertEquals(message.includes('file'), true);
    assertEquals(message.includes('preview'), true);
    assertEquals(message.includes('media'), true);
  }
});

Deno.test('validateThumbnailColumns: checks each table independently', () => {
  const introspected = {
    tables: [
      {
        name: 'media',
        columns: [
          { propertyName: 'id' },
          { propertyName: 'file', cmsOptions: { thumbnail: true } },
        ],
      },
      {
        name: 'gallery',
        columns: [
          { propertyName: 'id' },
          { propertyName: 'image', cmsOptions: { thumbnail: true } },
        ],
      },
    ],
  };
  validateThumbnailColumns(introspected); // Should not throw - one per table is fine
});

// =============================================================================
// validateAutoDraft tests
// =============================================================================

Deno.test('validateAutoDraft: accepts table with all nullable columns', () => {
  const introspected = {
    tables: [{
      name: 'media',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'file',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: false,
        },
        {
          propertyName: 'alt',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: false,
        },
      ],
    }],
  };
  // Should not throw
  validateAutoDraft(introspected);
});

Deno.test('validateAutoDraft: accepts table with all columns having defaults', () => {
  const introspected = {
    tables: [{
      name: 'uploads',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'status',
          isPrimaryKey: false,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'created_at',
          isPrimaryKey: false,
          hasDefault: true,
          notNull: true,
        },
      ],
    }],
  };
  validateAutoDraft(introspected);
});

Deno.test('validateAutoDraft: accepts table with mix of nullable and defaulted', () => {
  const introspected = {
    tables: [{
      name: 'posts',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'title',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: false,
        },
        {
          propertyName: 'published',
          isPrimaryKey: false,
          hasDefault: true,
          notNull: true,
        },
      ],
    }],
  };
  validateAutoDraft(introspected);
});

Deno.test('validateAutoDraft: rejects table with NOT NULL column without default', () => {
  const introspected = {
    tables: [{
      name: 'posts',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'title',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: true,
        },
      ],
    }],
  };
  assertThrows(
    () => validateAutoDraft(introspected),
    CmsConfigError,
    'title',
  );
});

Deno.test('validateAutoDraft: reports multiple blocking columns', () => {
  const introspected = {
    tables: [{
      name: 'posts',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'title',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: true,
        },
        {
          propertyName: 'slug',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: true,
        },
      ],
    }],
  };
  try {
    validateAutoDraft(introspected);
  } catch (error) {
    const message = (error as CmsConfigError).message;
    assertEquals(message.includes('title'), true);
    assertEquals(message.includes('slug'), true);
  }
});

Deno.test('validateAutoDraft: skips tables without autoDraft', () => {
  const introspected = {
    tables: [{
      name: 'posts',
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: true,
          notNull: true,
        },
        {
          propertyName: 'title',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: true,
        },
      ],
    }],
  };
  // Should not throw — autoDraft is not set
  validateAutoDraft(introspected);
});

Deno.test('validateAutoDraft: rejects PK without default', () => {
  const introspected = {
    tables: [{
      name: 'media',
      cmsOptions: { autoDraft: true },
      columns: [
        {
          propertyName: 'id',
          isPrimaryKey: true,
          hasDefault: false,
          notNull: true,
        },
        {
          propertyName: 'file',
          isPrimaryKey: false,
          hasDefault: false,
          notNull: false,
        },
      ],
    }],
  };
  assertThrows(
    () => validateAutoDraft(introspected),
    CmsConfigError,
    'id',
  );
});

// =============================================================================
// canAutoCreateDraft tests
// =============================================================================

import { canAutoCreateDraft } from '../crud-helpers.ts';
import type { IntrospectedTable } from '@hotsauce/core';

function makeTable(
  columns: Array<
    {
      name: string;
      isPrimaryKey: boolean;
      hasDefault: boolean;
      notNull: boolean;
    }
  >,
): IntrospectedTable {
  return {
    name: 'test',
    primaryKey: columns.filter((c) => c.isPrimaryKey).map((c) => c.name),
    columns: columns.map(({ name, ...rest }) => ({
      ...rest,
      propertyName: name,
      dbName: name,
      columnType: 'string',
      dataType: 'string',
      isUnique: false,
    })),
    table: {},
  };
}

Deno.test('canAutoCreateDraft: true when all columns nullable', () => {
  const table = makeTable([
    { name: 'id', isPrimaryKey: true, hasDefault: true, notNull: true },
    { name: 'file', isPrimaryKey: false, hasDefault: false, notNull: false },
  ]);
  assertEquals(canAutoCreateDraft(table), true);
});

Deno.test('canAutoCreateDraft: true when all columns have defaults', () => {
  const table = makeTable([
    { name: 'id', isPrimaryKey: true, hasDefault: true, notNull: true },
    { name: 'status', isPrimaryKey: false, hasDefault: true, notNull: true },
  ]);
  assertEquals(canAutoCreateDraft(table), true);
});

Deno.test('canAutoCreateDraft: false when NOT NULL column has no default', () => {
  const table = makeTable([
    { name: 'id', isPrimaryKey: true, hasDefault: true, notNull: true },
    { name: 'title', isPrimaryKey: false, hasDefault: false, notNull: true },
  ]);
  assertEquals(canAutoCreateDraft(table), false);
});

Deno.test('canAutoCreateDraft: false when PK has no default', () => {
  const table = makeTable([
    { name: 'id', isPrimaryKey: true, hasDefault: false, notNull: true },
    { name: 'file', isPrimaryKey: false, hasDefault: false, notNull: false },
  ]);
  assertEquals(canAutoCreateDraft(table), false);
});
