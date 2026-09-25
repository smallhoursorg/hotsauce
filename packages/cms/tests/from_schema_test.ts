/**
 * @module from_schema_test
 * Tests for policiesFromSchema function.
 */

import { assertEquals } from '@std/assert';
import { integer, json, pgTable, serial, text } from 'drizzle-orm/pg-core';
import '../../core/extend/mod.ts'; // Enable $cms() method
import {
  getColumnPluginSources,
  policiesFromSchema,
} from '../policies/from-schema.ts';
import type {
  PolicyContext,
  PolicyFn,
  TablePolicy,
} from '../policies/types.ts';
import { ownedBy } from '../policies/mod.ts';

// ─────────────────────────────────────────────────────────────
// Test Schema
// ─────────────────────────────────────────────────────────────

// Table with plugin-enabled column
const pages = pgTable('pages', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  // deno-lint-ignore no-explicit-any
  content: (json('content') as any).$cms({ plugins: { puck: true } }),
  authorId: integer('author_id').notNull(),
});

// Table with multiple plugins on same column
const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title'),
  // deno-lint-ignore no-explicit-any
  body: (json('body') as any).$cms({
    plugins: {
      puck: true,
      'block-editor': { write: true },
    },
  }),
});

// Table without plugin config
const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

// Table with plugin config but no write access
const drafts = pgTable('drafts', {
  id: serial('id').primaryKey(),
  // deno-lint-ignore no-explicit-any
  content: (json('content') as any).$cms({
    plugins: { puck: { read: true } }, // read only, no write
  }),
});

const testSchema = { pages, posts, users, drafts };

// ─────────────────────────────────────────────────────────────
// policiesFromSchema
// ─────────────────────────────────────────────────────────────

Deno.test('policiesFromSchema: generates column policy for plugin-enabled columns', () => {
  const policies = policiesFromSchema(testSchema);

  // Should have policy for pages table
  assertEquals('pages' in policies, true);
  const pagePolicy = policies.pages as TablePolicy;
  assertEquals(typeof pagePolicy, 'object');
  assertEquals('columns' in pagePolicy, true);
  assertEquals('content' in (pagePolicy.columns ?? {}), true);
});

Deno.test('policiesFromSchema: skips tables without plugin config', () => {
  const policies = policiesFromSchema(testSchema);

  // users table has no plugin config
  assertEquals('users' in policies, false);
});

Deno.test('policiesFromSchema: skips columns with read-only plugin access', () => {
  const policies = policiesFromSchema(testSchema);

  // drafts table has only read access for puck
  assertEquals('drafts' in policies, false);
});

Deno.test('policiesFromSchema: generated write policy allows plugin source', () => {
  const policies = policiesFromSchema(testSchema);
  const pagePolicy = policies.pages as TablePolicy;
  const writePolicy = pagePolicy.columns?.content?.write;

  assertEquals(typeof writePolicy, 'function');

  // Should allow plugin:puck source
  const ctx: PolicyContext = {
    user: { sub: 'user-1' },
    request: new Request('http://test'),
    source: 'plugin:puck',
  };
  assertEquals(writePolicy?.(ctx), true);
});

Deno.test('policiesFromSchema: generated write policy denies other sources', () => {
  const policies = policiesFromSchema(testSchema);
  const pagePolicy = policies.pages as TablePolicy;
  const writePolicy = pagePolicy.columns?.content?.write;

  // Should deny cms source (not in allowed list)
  const ctx: PolicyContext = {
    user: { sub: 'user-1' },
    request: new Request('http://test'),
    source: 'cms',
  };
  assertEquals(writePolicy?.(ctx), false);

  // Should deny other plugin sources
  const ctx2: PolicyContext = {
    user: { sub: 'user-1' },
    request: new Request('http://test'),
    source: 'plugin:other',
  };
  assertEquals(writePolicy?.(ctx2), false);
});

Deno.test('policiesFromSchema: multiple plugins are all allowed', () => {
  const policies = policiesFromSchema(testSchema);
  const postPolicy = policies.posts as TablePolicy;
  const writePolicy = postPolicy.columns?.body?.write;

  // Should allow both plugins
  const ctx1: PolicyContext = {
    user: { sub: 'user-1' },
    request: new Request('http://test'),
    source: 'plugin:puck',
  };
  assertEquals(writePolicy?.(ctx1), true);

  const ctx2: PolicyContext = {
    user: { sub: 'user-1' },
    request: new Request('http://test'),
    source: 'plugin:block-editor',
  };
  assertEquals(writePolicy?.(ctx2), true);
});

// ─────────────────────────────────────────────────────────────
// Merge with additional policies
// ─────────────────────────────────────────────────────────────

Deno.test('policiesFromSchema: merges with additional policies', () => {
  const policies = policiesFromSchema(testSchema, {
    users: ownedBy(users, 'id'), // Add row policy for users
  });

  // Should have both generated and additional policies
  assertEquals('pages' in policies, true);
  assertEquals('posts' in policies, true);
  assertEquals('users' in policies, true);
});

Deno.test('policiesFromSchema: user policies take precedence for same table', () => {
  // Custom policy that always denies - returning undefined is deny
  const customPolicy: PolicyFn = () => undefined;

  const policies = policiesFromSchema(testSchema, {
    pages: customPolicy,
  });

  // User's simple policy should replace generated one
  assertEquals(policies.pages, customPolicy);
});

Deno.test('policiesFromSchema: merges row and column policies for same table', () => {
  const rowPolicy = ownedBy(pages, 'authorId');

  const policies = policiesFromSchema(testSchema, {
    pages: { row: rowPolicy },
  });

  const pagePolicy = policies.pages as TablePolicy;

  // Should have both row and columns
  assertEquals(pagePolicy.row, rowPolicy);
  assertEquals('columns' in pagePolicy, true);
  assertEquals('content' in (pagePolicy.columns ?? {}), true);
});

Deno.test('policiesFromSchema: user column policy overrides generated', () => {
  const customColumnPolicy = () => false;

  const policies = policiesFromSchema(testSchema, {
    pages: {
      columns: {
        content: { write: customColumnPolicy },
      },
    },
  });

  const pagePolicy = policies.pages as TablePolicy;
  assertEquals(pagePolicy.columns?.content?.write, customColumnPolicy);
});

// ─────────────────────────────────────────────────────────────
// getColumnPluginSources
// ─────────────────────────────────────────────────────────────

Deno.test('getColumnPluginSources: returns sources for configured column', () => {
  const sources = getColumnPluginSources(testSchema, 'pages', 'content');
  assertEquals(sources, ['plugin:puck']);
});

Deno.test('getColumnPluginSources: returns multiple sources', () => {
  const sources = getColumnPluginSources(testSchema, 'posts', 'body');
  assertEquals(sources.length, 2);
  assertEquals(sources.includes('plugin:puck'), true);
  assertEquals(sources.includes('plugin:block-editor'), true);
});

Deno.test('getColumnPluginSources: returns empty for column without plugins', () => {
  const sources = getColumnPluginSources(testSchema, 'users', 'name');
  assertEquals(sources, []);
});

Deno.test('getColumnPluginSources: returns empty for non-existent table', () => {
  const sources = getColumnPluginSources(testSchema, 'nonexistent', 'content');
  assertEquals(sources, []);
});

Deno.test('getColumnPluginSources: returns empty for non-existent column', () => {
  const sources = getColumnPluginSources(testSchema, 'pages', 'nonexistent');
  assertEquals(sources, []);
});

Deno.test('getColumnPluginSources: returns empty for read-only plugin access', () => {
  const sources = getColumnPluginSources(testSchema, 'drafts', 'content');
  assertEquals(sources, []);
});

// ─────────────────────────────────────────────────────────────
// Column policy keys use the Drizzle property name
// ─────────────────────────────────────────────────────────────

Deno.test('policiesFromSchema: keys column policies by property name, not DB name', async () => {
  const layouts = pgTable('layouts', {
    id: serial('id').primaryKey(),
    // Property name (pageContent) differs from the DB column name (page_content)
    // deno-lint-ignore no-explicit-any
    pageContent: (json('page_content') as any).$cms({
      plugins: { puck: true },
    }),
  });

  const policies = policiesFromSchema({ layouts });
  const policy = policies.layouts as TablePolicy;

  assertEquals(
    Object.keys(policy.columns ?? {}),
    ['pageContent'],
    'evaluateColumnPolicies looks policies up by propertyName, so the generated key must match',
  );

  const write = policy.columns?.pageContent?.write;
  if (!write) throw new Error('expected a write policy for pageContent');
  const ctx = (source: string): PolicyContext => ({
    user: undefined,
    request: new Request('http://localhost/admin'),
    source,
  });
  assertEquals(await write(ctx('plugin:puck')), true);
  assertEquals(await write(ctx('cms')), false);
});
