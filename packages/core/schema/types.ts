// Core types for schema introspection

import type { CmsColumnOptions, CmsTableOptions } from '../extend/types.ts';

// Re-export Drizzle's types for use in introspection
export { Table } from 'drizzle-orm';
export type { AnyColumn as Column } from 'drizzle-orm';

/**
 * Metadata extracted from a Drizzle column
 */
export interface IntrospectedColumn {
  /**
   * Property name in the Drizzle schema (e.g. `authorId`).
   *
   * This is the canonical column identifier throughout the CMS: Drizzle keys
   * records, table objects and insert/update payloads by it, and so do CMS
   * policies, form fields, URLs, plugin contexts and storage keys.
   */
  propertyName: string;

  /**
   * Column name in the database (e.g. `author_id`).
   *
   * Only needed when talking to the database by name (raw SQL, migrations,
   * error messages that quote the physical schema). Never use it to index a
   * record or a Drizzle table object.
   */
  dbName: string;

  /** Drizzle column type (PgVarchar, PgText, PgInteger, etc.) */
  columnType: string;

  /** TypeScript data type (string, number, boolean, date, etc.) */
  dataType: string;

  /** Whether the column has a NOT NULL constraint */
  notNull: boolean;

  /** Whether the column has a default value */
  hasDefault: boolean;

  /** Whether this is the primary key */
  isPrimaryKey: boolean;

  /** Whether the column has a unique constraint */
  isUnique: boolean;

  /** Max length for varchar columns */
  maxLength?: number;

  /** Enum values if this is an enum column */
  enumValues?: readonly string[];

  /** Enum name if this is an enum column */
  enumName?: string;

  /** Whether this is an array column (Postgres arrays) */
  isArray?: boolean;

  /** Foreign key reference if this column references another table */
  references?: {
    /** Referenced table name (database name) */
    table: string;
    /** Referenced column (database name — Drizzle FK metadata only exposes this) */
    column: string;
  };

  /** Optional CMS-specific metadata attached via column builder `$cms()` */
  cmsOptions?: CmsColumnOptions;
}

/**
 * Metadata extracted from a Drizzle table
 */
export interface IntrospectedTable {
  /** Table name in the database */
  name: string;

  /** All columns in the table */
  columns: IntrospectedColumn[];

  /** Primary key column(s), as property names */
  primaryKey: string[];

  /** Reference to the original Drizzle table object */
  table: unknown;

  /** Whether this table is a junction table for many-to-many relations */
  isJunction?: boolean;

  /** Optional CMS-specific metadata attached via table `$cms()` */
  cmsOptions?: CmsTableOptions;
}

/**
 * Represents a junction (link) table for many-to-many relations
 */
export interface JunctionTable {
  /** The junction table name */
  tableName: string;

  /** First related table */
  leftTable: string;
  /** FK column pointing to left table (propertyName) */
  leftColumn: string;

  /** Second related table */
  rightTable: string;
  /** FK column pointing to right table (propertyName) */
  rightColumn: string;
}

/**
 * Many-to-many relation metadata attached to a table
 */
export interface ManyToManyRelation {
  /** The related table (the "other side" of the M2M) */
  relatedTable: string;
  /** The junction table info */
  junction: JunctionTable;
}

/**
 * Type of relation between tables
 */
export type RelationType = 'one' | 'many';

/**
 * Metadata extracted from a Drizzle relation
 */
export interface IntrospectedRelation {
  /** Name of this relation (as defined in the relations config) */
  name: string;

  /** The source table name */
  sourceTable: string;

  /** The target/related table name */
  targetTable: string;

  /** Type of relation: 'one' (belongs-to) or 'many' (has-many) */
  type: RelationType;

  /** Source column(s) that form the relation (foreign key columns) */
  sourceColumns?: string[];

  /** Target column(s) that are referenced */
  targetColumns?: string[];
}

/**
 * Full schema introspection result including tables and relations
 */
export interface IntrospectedSchema {
  /** All tables in the schema */
  tables: IntrospectedTable[];

  /** All relations defined in the schema */
  relations: IntrospectedRelation[];

  /** Detected junction tables for many-to-many relations */
  junctions: JunctionTable[];
}
