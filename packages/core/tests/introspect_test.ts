// Tests for schema introspection

import { assertEquals, assertExists, assertThrows } from '@std/assert';
import {
  detectJunctionTables,
  introspectFullSchema,
  introspectRelations,
  introspectSchema,
  introspectTable,
} from '../schema/introspect.ts';
import * as schema from './fixtures/schema-pg.ts';
import * as sqliteSchema from './fixtures/schema-sqlite.ts';

Deno.test('introspectTable - extracts table name', () => {
  const result = introspectTable(schema.users);
  assertEquals(result.name, 'users');
});

Deno.test('introspectTable - extracts all columns', () => {
  const result = introspectTable(schema.users);

  const columnNames = result.columns.map((c) => c.dbName);
  assertEquals(columnNames.includes('id'), true);
  assertEquals(columnNames.includes('email'), true);
  assertEquals(columnNames.includes('name'), true);
  assertEquals(columnNames.includes('bio'), true);
  assertEquals(columnNames.includes('is_admin'), true);
  assertEquals(columnNames.includes('created_at'), true);
});

Deno.test('introspectTable - extracts primary key', () => {
  const result = introspectTable(schema.users);
  assertEquals(result.primaryKey, ['id']);
});

Deno.test('introspectTable - extracts column metadata', () => {
  const result = introspectTable(schema.users);

  const emailColumn = result.columns.find((c) => c.dbName === 'email');
  assertExists(emailColumn);
  assertEquals(emailColumn.columnType, 'PgVarchar');
  assertEquals(emailColumn.dataType, 'string');
  assertEquals(emailColumn.notNull, true);
  assertEquals(emailColumn.hasDefault, false);
  assertEquals(emailColumn.isUnique, true);
  assertEquals(emailColumn.maxLength, 255);
});

Deno.test('introspectTable - extracts nullable column', () => {
  const result = introspectTable(schema.users);

  const bioColumn = result.columns.find((c) => c.dbName === 'bio');
  assertExists(bioColumn);
  assertEquals(bioColumn.notNull, false);
  assertEquals(bioColumn.columnType, 'PgText');
});

Deno.test('introspectTable - extracts column with default', () => {
  const result = introspectTable(schema.users);

  const isAdminColumn = result.columns.find((c) => c.dbName === 'is_admin');
  assertExists(isAdminColumn);
  assertEquals(isAdminColumn.hasDefault, true);
  assertEquals(isAdminColumn.notNull, true);
});

Deno.test('introspectTable - extracts enum column', () => {
  const result = introspectTable(schema.posts);

  const statusColumn = result.columns.find((c) => c.dbName === 'status');
  assertExists(statusColumn);
  assertEquals(statusColumn.columnType, 'PgEnumColumn');
  assertEquals(statusColumn.enumName, 'post_status');
  assertEquals(statusColumn.enumValues, ['draft', 'published', 'archived']);
});

Deno.test('introspectTable - extracts foreign key reference', () => {
  const result = introspectTable(schema.posts);

  const authorIdColumn = result.columns.find((c) => c.dbName === 'author_id');
  assertExists(authorIdColumn);
  assertExists(authorIdColumn.references);
  assertEquals(authorIdColumn.references.table, 'users');
  assertEquals(authorIdColumn.references.column, 'id');
});

Deno.test('introspectTable - extracts property name (camelCase)', () => {
  const result = introspectTable(schema.users);

  const isAdminColumn = result.columns.find((c) => c.dbName === 'is_admin');
  assertExists(isAdminColumn);
  assertEquals(isAdminColumn.propertyName, 'isAdmin');
});

Deno.test('introspectTable - extracts timestamp columns', () => {
  const result = introspectTable(schema.posts);

  const publishedAt = result.columns.find((c) => c.dbName === 'published_at');
  assertExists(publishedAt);
  assertEquals(publishedAt.columnType, 'PgTimestamp');
  assertEquals(publishedAt.dataType, 'date');
  assertEquals(publishedAt.notNull, false);
  assertEquals(publishedAt.hasDefault, false);

  const createdAt = result.columns.find((c) => c.dbName === 'created_at');
  assertExists(createdAt);
  assertEquals(createdAt.notNull, true);
  assertEquals(createdAt.hasDefault, true);
});

Deno.test('introspectTable - extracts UUID column', () => {
  const result = introspectTable(schema.uploads);

  const idColumn = result.columns.find((c) => c.dbName === 'id');
  assertExists(idColumn);
  assertEquals(idColumn.columnType, 'PgUUID');
  assertEquals(idColumn.isPrimaryKey, true);
});

Deno.test('introspectTable - extracts JSON column', () => {
  const result = introspectTable(schema.uploads);

  const metadataColumn = result.columns.find((c) => c.dbName === 'metadata');
  assertExists(metadataColumn);
  assertEquals(metadataColumn.columnType, 'PgJson');
});

Deno.test('introspectTable - extracts array column', () => {
  const result = introspectTable(schema.posts);

  const tagsColumn = result.columns.find((c) => c.dbName === 'tags');
  assertExists(tagsColumn);
  assertEquals(tagsColumn.columnType, 'PgArray');
  assertEquals(tagsColumn.isArray, true);
});

Deno.test('introspectTable - extracts composite primary key', () => {
  const result = introspectTable(schema.postsToCategories);

  // Should have both columns as primary key
  assertEquals(result.primaryKey.length, 2);
  assertEquals(result.primaryKey.includes('postId'), true);
  assertEquals(result.primaryKey.includes('categoryId'), true);

  // Individual columns should be marked as primary key
  const postIdColumn = result.columns.find((c) => c.dbName === 'post_id');
  const categoryIdColumn = result.columns.find((c) =>
    c.dbName === 'category_id'
  );
  assertExists(postIdColumn);
  assertExists(categoryIdColumn);
  assertEquals(postIdColumn.isPrimaryKey, true);
  assertEquals(categoryIdColumn.isPrimaryKey, true);
});

Deno.test('introspectSchema - extracts all tables', () => {
  const tables = introspectSchema(schema);

  const tableNames = tables.map((t) => t.name);
  assertEquals(tableNames.includes('users'), true);
  assertEquals(tableNames.includes('posts'), true);
  assertEquals(tableNames.includes('categories'), true);
  assertEquals(tableNames.includes('uploads'), true);
  assertEquals(tableNames.includes('settings'), true);
  assertEquals(tableNames.includes('posts_to_categories'), true);
});

Deno.test('introspectSchema - skips non-table exports', () => {
  const tables = introspectSchema(schema);

  // Relations and enums should not be included as tables
  const tableNames = tables.map((t) => t.name);
  assertEquals(tableNames.includes('usersRelations'), false);
  assertEquals(tableNames.includes('postStatus'), false);
});

// Error handling tests
Deno.test('introspectTable - throws on null input', () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => introspectTable(null as any),
    Error,
    'expected a table object',
  );
});

Deno.test('introspectTable - throws on non-table object', () => {
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => introspectTable({ notATable: true } as any),
    Error,
    'not a valid Drizzle table',
  );
});

// Relations introspection tests
Deno.test('introspectRelations - extracts all relations', () => {
  const relations = introspectRelations(schema);

  // Should find relations for users, posts, categories, postsToCategories
  assertEquals(relations.length > 0, true);

  // Check users -> posts relation (many)
  const usersPosts = relations.find(
    (r) => r.sourceTable === 'users' && r.name === 'posts',
  );
  assertExists(usersPosts);
  assertEquals(usersPosts.type, 'many');
  assertEquals(usersPosts.targetTable, 'posts');
});

Deno.test('introspectRelations - extracts one relations', () => {
  const relations = introspectRelations(schema);

  // posts.author is a "one" relation
  const postsAuthor = relations.find(
    (r) => r.sourceTable === 'posts' && r.name === 'author',
  );
  assertExists(postsAuthor);
  assertEquals(postsAuthor.type, 'one');
  assertEquals(postsAuthor.targetTable, 'users');
});

Deno.test('introspectFullSchema - returns tables and relations', () => {
  const result = introspectFullSchema(schema);

  // Should have both tables and relations
  assertEquals(result.tables.length > 0, true);
  assertEquals(result.relations.length > 0, true);

  // Tables should include our schema tables
  const tableNames = result.tables.map((t) => t.name);
  assertEquals(tableNames.includes('users'), true);
  assertEquals(tableNames.includes('posts'), true);
});

// Junction table detection tests
Deno.test('detectJunctionTables - detects posts_to_categories as junction', () => {
  const tables = introspectSchema(schema);
  const junctions = detectJunctionTables(tables);

  assertEquals(junctions.length, 1);
  assertEquals(junctions[0]?.tableName, 'posts_to_categories');
});

Deno.test('detectJunctionTables - extracts left and right tables', () => {
  const tables = introspectSchema(schema);
  const junctions = detectJunctionTables(tables);

  const junction = junctions[0];
  assertExists(junction);

  // Tables sorted alphabetically: categories < posts
  assertEquals(junction.leftTable, 'categories');
  assertEquals(junction.leftColumn, 'categoryId');
  assertEquals(junction.rightTable, 'posts');
  assertEquals(junction.rightColumn, 'postId');
});

Deno.test('detectJunctionTables - does not detect normal tables', () => {
  const tables = introspectSchema(schema);
  const junctions = detectJunctionTables(tables);

  const junctionNames = junctions.map((j) => j.tableName);
  assertEquals(junctionNames.includes('users'), false);
  assertEquals(junctionNames.includes('posts'), false);
  assertEquals(junctionNames.includes('categories'), false);
});

Deno.test('introspectFullSchema - includes junctions array', () => {
  const result = introspectFullSchema(schema);

  assertExists(result.junctions);
  assertEquals(result.junctions.length, 1);
  assertEquals(result.junctions[0]?.tableName, 'posts_to_categories');
});

Deno.test('introspectFullSchema - marks junction tables with isJunction', () => {
  const result = introspectFullSchema(schema);

  const junctionTable = result.tables.find((t) =>
    t.name === 'posts_to_categories'
  );
  assertExists(junctionTable);
  assertEquals(junctionTable.isJunction, true);

  // Normal tables should not be marked
  const postsTable = result.tables.find((t) => t.name === 'posts');
  assertExists(postsTable);
  assertEquals(postsTable.isJunction, undefined);
});

// ============================================================================
// SQLite Schema Tests
// ============================================================================

Deno.test('sqlite: introspectTable - extracts table name', () => {
  const result = introspectTable(sqliteSchema.users);
  assertEquals(result.name, 'users');
});

Deno.test('sqlite: introspectTable - extracts all columns', () => {
  const result = introspectTable(sqliteSchema.users);

  const columnNames = result.columns.map((c) => c.dbName);
  assertEquals(columnNames.includes('id'), true);
  assertEquals(columnNames.includes('email'), true);
  assertEquals(columnNames.includes('name'), true);
  assertEquals(columnNames.includes('bio'), true);
  assertEquals(columnNames.includes('is_admin'), true);
  assertEquals(columnNames.includes('created_at'), true);
});

Deno.test('sqlite: introspectTable - extracts primary key', () => {
  const result = introspectTable(sqliteSchema.users);
  assertEquals(result.primaryKey, ['id']);
});

Deno.test('sqlite: introspectTable - extracts column metadata', () => {
  const result = introspectTable(sqliteSchema.users);

  const emailColumn = result.columns.find((c) => c.dbName === 'email');
  assertExists(emailColumn);
  assertEquals(emailColumn.columnType, 'SQLiteText');
  assertEquals(emailColumn.dataType, 'string');
  assertEquals(emailColumn.notNull, true);
  assertEquals(emailColumn.hasDefault, false);
  assertEquals(emailColumn.isUnique, true);
});

Deno.test('sqlite: introspectTable - extracts nullable column', () => {
  const result = introspectTable(sqliteSchema.users);

  const bioColumn = result.columns.find((c) => c.dbName === 'bio');
  assertExists(bioColumn);
  assertEquals(bioColumn.notNull, false);
  assertEquals(bioColumn.columnType, 'SQLiteText');
});

Deno.test('sqlite: introspectTable - extracts column with default', () => {
  const result = introspectTable(sqliteSchema.users);

  const isAdminColumn = result.columns.find((c) => c.dbName === 'is_admin');
  assertExists(isAdminColumn);
  assertEquals(isAdminColumn.hasDefault, true);
  assertEquals(isAdminColumn.notNull, true);
});

Deno.test('sqlite: introspectTable - extracts text enum column', () => {
  const result = introspectTable(sqliteSchema.posts);

  const statusColumn = result.columns.find((c) => c.dbName === 'status');
  assertExists(statusColumn);
  assertEquals(statusColumn.columnType, 'SQLiteText');
  assertEquals(statusColumn.enumValues, ['draft', 'published', 'archived']);
});

Deno.test('sqlite: introspectTable - extracts foreign key reference', () => {
  const result = introspectTable(sqliteSchema.posts);

  const authorIdColumn = result.columns.find((c) => c.dbName === 'author_id');
  assertExists(authorIdColumn);
  assertExists(authorIdColumn.references);
  assertEquals(authorIdColumn.references.table, 'users');
  assertEquals(authorIdColumn.references.column, 'id');
});

Deno.test('sqlite: introspectTable - extracts property name (camelCase)', () => {
  const result = introspectTable(sqliteSchema.users);

  const isAdminColumn = result.columns.find((c) => c.dbName === 'is_admin');
  assertExists(isAdminColumn);
  assertEquals(isAdminColumn.propertyName, 'isAdmin');
});

Deno.test('sqlite: introspectTable - extracts timestamp columns (integer mode)', () => {
  const result = introspectTable(sqliteSchema.posts);

  const publishedAt = result.columns.find((c) => c.dbName === 'published_at');
  assertExists(publishedAt);
  assertEquals(publishedAt.columnType, 'SQLiteTimestamp');
  assertEquals(publishedAt.dataType, 'date');
  assertEquals(publishedAt.notNull, false);

  const createdAt = result.columns.find((c) => c.dbName === 'created_at');
  assertExists(createdAt);
  assertEquals(createdAt.notNull, true);
  assertEquals(createdAt.hasDefault, true);
});

Deno.test('sqlite: introspectTable - extracts JSON column (text mode)', () => {
  const result = introspectTable(sqliteSchema.uploads);

  const metadataColumn = result.columns.find((c) => c.dbName === 'metadata');
  assertExists(metadataColumn);
  // SQLite JSON is stored as text with mode: 'json'
  assertEquals(metadataColumn.columnType, 'SQLiteTextJson');
});

Deno.test('sqlite: introspectTable - extracts composite primary key', () => {
  const result = introspectTable(sqliteSchema.postsToCategories);

  // Should have both columns as primary key
  assertEquals(result.primaryKey.length, 2);
  assertEquals(result.primaryKey.includes('postId'), true);
  assertEquals(result.primaryKey.includes('categoryId'), true);

  // Individual columns should be marked as primary key
  const postIdColumn = result.columns.find((c) => c.dbName === 'post_id');
  const categoryIdColumn = result.columns.find((c) =>
    c.dbName === 'category_id'
  );
  assertExists(postIdColumn);
  assertExists(categoryIdColumn);
  assertEquals(postIdColumn.isPrimaryKey, true);
  assertEquals(categoryIdColumn.isPrimaryKey, true);
});

Deno.test('sqlite: introspectSchema - extracts all tables', () => {
  const tables = introspectSchema(sqliteSchema);

  const tableNames = tables.map((t) => t.name);
  assertEquals(tableNames.includes('users'), true);
  assertEquals(tableNames.includes('posts'), true);
  assertEquals(tableNames.includes('categories'), true);
  assertEquals(tableNames.includes('uploads'), true);
  assertEquals(tableNames.includes('settings'), true);
  assertEquals(tableNames.includes('posts_to_categories'), true);
});

Deno.test('sqlite: introspectSchema - skips non-table exports', () => {
  const tables = introspectSchema(sqliteSchema);

  // Relations should not be included as tables
  const tableNames = tables.map((t) => t.name);
  assertEquals(tableNames.includes('usersRelations'), false);
});

Deno.test('sqlite: introspectRelations - extracts all relations', () => {
  const relations = introspectRelations(sqliteSchema);

  // Should find relations for users, posts, categories, postsToCategories
  assertEquals(relations.length > 0, true);

  // Check users -> posts relation (many)
  const usersPosts = relations.find(
    (r) => r.sourceTable === 'users' && r.name === 'posts',
  );
  assertExists(usersPosts);
  assertEquals(usersPosts.type, 'many');
  assertEquals(usersPosts.targetTable, 'posts');
});

Deno.test('sqlite: introspectRelations - extracts one relations', () => {
  const relations = introspectRelations(sqliteSchema);

  // posts.author is a "one" relation
  const postsAuthor = relations.find(
    (r) => r.sourceTable === 'posts' && r.name === 'author',
  );
  assertExists(postsAuthor);
  assertEquals(postsAuthor.type, 'one');
  assertEquals(postsAuthor.targetTable, 'users');
});

Deno.test('sqlite: introspectFullSchema - returns tables and relations', () => {
  const result = introspectFullSchema(sqliteSchema);

  // Should have both tables and relations
  assertEquals(result.tables.length > 0, true);
  assertEquals(result.relations.length > 0, true);

  // Tables should include our schema tables
  const tableNames = result.tables.map((t) => t.name);
  assertEquals(tableNames.includes('users'), true);
  assertEquals(tableNames.includes('posts'), true);
});

Deno.test('sqlite: detectJunctionTables - detects posts_to_categories as junction', () => {
  const tables = introspectSchema(sqliteSchema);
  const junctions = detectJunctionTables(tables);

  assertEquals(junctions.length, 1);
  assertEquals(junctions[0]?.tableName, 'posts_to_categories');
});

Deno.test('sqlite: detectJunctionTables - extracts left and right tables', () => {
  const tables = introspectSchema(sqliteSchema);
  const junctions = detectJunctionTables(tables);

  const junction = junctions[0];
  assertExists(junction);

  // Tables sorted alphabetically: categories < posts
  assertEquals(junction.leftTable, 'categories');
  assertEquals(junction.leftColumn, 'categoryId');
  assertEquals(junction.rightTable, 'posts');
  assertEquals(junction.rightColumn, 'postId');
});

Deno.test('sqlite: introspectFullSchema - includes junctions array', () => {
  const result = introspectFullSchema(sqliteSchema);

  assertExists(result.junctions);
  assertEquals(result.junctions.length, 1);
  assertEquals(result.junctions[0]?.tableName, 'posts_to_categories');
});

Deno.test('sqlite: introspectFullSchema - marks junction tables with isJunction', () => {
  const result = introspectFullSchema(sqliteSchema);

  const junctionTable = result.tables.find((t) =>
    t.name === 'posts_to_categories'
  );
  assertExists(junctionTable);
  assertEquals(junctionTable.isJunction, true);

  // Normal tables should not be marked
  const postsTable = result.tables.find((t) => t.name === 'posts');
  assertExists(postsTable);
  assertEquals(postsTable.isJunction, undefined);
});
