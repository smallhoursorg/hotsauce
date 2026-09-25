/**
 * @module
 *
 * Schema introspection, field mapping, and validation for Drizzle ORM.
 *
 * This module provides tools to extract metadata from Drizzle schemas,
 * map database column types to CMS field types, and generate Zod validation
 * schemas. Works with any Drizzle dialect: Postgres, MySQL, SQLite.
 *
 * @example
 * ```ts
 * import { introspectSchema, mapColumnsToFields } from "@hotsauce/core";
 *
 * const schema = introspectSchema({ users, posts });
 * const fields = mapColumnsToFields(schema.users.columns);
 * ```
 */

// ─────────────────────────────────────────────────────────────
// Types - Core data structures for introspected schema metadata
// ─────────────────────────────────────────────────────────────
export type {
  IntrospectedColumn,
  IntrospectedRelation,
  IntrospectedSchema,
  IntrospectedTable,
  JunctionTable,
  ManyToManyRelation,
  RelationType,
} from './schema/types.ts';

// Re-export Drizzle's Table type for convenience
export { Table } from './schema/types.ts';

// ─────────────────────────────────────────────────────────────
// Schema Introspection - Extract metadata from Drizzle tables
// Works with any dialect: Postgres, MySQL, SQLite
// ─────────────────────────────────────────────────────────────
export {
  detectJunctionTables,
  introspectFullSchema,
  introspectRelations,
  introspectSchema,
  introspectTable,
} from './schema/introspect.ts';

// ─────────────────────────────────────────────────────────────
// Field Mapping - Convert columns to UI field definitions
// Maps database types to CMS field types (text, number, relation, etc.)
// ─────────────────────────────────────────────────────────────
export type { CMSField, CMSFieldType } from './fields/mapping.ts';
export {
  getThumbnailField,
  isAuditTimestampColumn,
  mapColumnsToFields,
  mapColumnToField,
  mapColumnToFieldType,
  propertyNameToLabel,
} from './fields/mapping.ts';

// ─────────────────────────────────────────────────────────────
// Validation - Zod schema generation (re-exported from drizzle-zod)
// Use for form validation in handlers
// ─────────────────────────────────────────────────────────────
export {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from './validation/zod.ts';

// ─────────────────────────────────────────────────────────────
// CMS Extension Types - Column and table metadata via $cms()
// ─────────────────────────────────────────────────────────────
export type {
  CmsColumnOptions,
  CmsTableOptions,
  FileReference,
  FrontendUrlFn,
  PluginColumnConfig,
} from './extend/types.ts';
export {
  CMS_TABLE_OPTIONS,
  FILE_DEFAULT_ACCEPT,
  FILE_DEFAULT_MAX_SIZE,
} from './extend/types.ts';
export {
  getFileKeyPrefix,
  isValidFileKey,
  isValidFileReference,
} from './extend/file.ts';
