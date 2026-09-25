// Schema introspection utilities

import {
  type AnyColumn,
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  getTableName,
  isTable,
  Table,
} from 'drizzle-orm';
import type {
  IntrospectedColumn,
  IntrospectedRelation,
  IntrospectedSchema,
  IntrospectedTable,
  JunctionTable,
} from './types.ts';

import type { CmsColumnOptions, CmsTableOptions } from '../extend/types.ts';
import { CMS_TABLE_OPTIONS } from '../extend/types.ts';

/** Symbols used by Drizzle to store inline foreign keys (database-specific, no helper exported) */
const TABLE_FOREIGN_KEY_SYMBOLS = [
  Symbol.for('drizzle:PgInlineForeignKeys'),
  Symbol.for('drizzle:MySqlInlineForeignKeys'),
  Symbol.for('drizzle:SQLiteInlineForeignKeys'),
];

/**
 * Check if a value is a Drizzle column
 */
function isDrizzleColumn(value: unknown): value is AnyColumn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'columnType' in value &&
    'dataType' in value
  );
}

/**
 * Extract foreign key references from a table
 */
function extractForeignKeys(
  table: Table,
): Map<string, { table: string; column: string }> {
  const refs = new Map<string, { table: string; column: string }>();

  // Try each database-specific symbol to find foreign keys
  let foreignKeys: unknown[] | undefined;
  for (const symbol of TABLE_FOREIGN_KEY_SYMBOLS) {
    // deno-lint-ignore no-explicit-any
    const fks = (table as any)[symbol];
    if (Array.isArray(fks) && fks.length > 0) {
      foreignKeys = fks;
      break;
    }
  }

  if (!foreignKeys) {
    return refs;
  }

  for (const fk of foreignKeys) {
    // deno-lint-ignore no-explicit-any
    const fkAny = fk as any;
    if (typeof fkAny?.reference !== 'function') continue;

    try {
      const refResult = fkAny.reference();
      if (!refResult?.columns?.[0] || !refResult?.foreignColumns?.[0]) continue;

      const localColumn = refResult.columns[0];
      const foreignColumn = refResult.foreignColumns[0];
      const foreignTable = foreignColumn.table;

      const localName = localColumn.name as string;
      const foreignTableName = getTableName(foreignTable);
      const foreignColumnName = foreignColumn.name as string;

      if (localName && foreignTableName && foreignColumnName) {
        refs.set(localName, {
          table: foreignTableName,
          column: foreignColumnName,
        });
      }
    } catch {
      // Skip malformed foreign keys
    }
  }

  return refs;
}

/**
 * Extract composite primary key columns from table extra config builder
 */
function extractCompositePrimaryKey(table: Table): string[] {
  // Use Drizzle's exported symbol via Table.Symbol (marked @internal but accessible)
  const TableSymbol =
    (Table as unknown as { Symbol: { ExtraConfigBuilder: symbol } }).Symbol;
  // deno-lint-ignore no-explicit-any
  const extraConfigBuilder = (table as any)[TableSymbol.ExtraConfigBuilder];
  if (typeof extraConfigBuilder !== 'function') {
    return [];
  }

  try {
    const extraConfig = extraConfigBuilder(table);
    if (!Array.isArray(extraConfig)) {
      return [];
    }

    for (const config of extraConfig) {
      // Check if this is a PrimaryKeyBuilder
      if (
        config?.constructor?.name === 'PrimaryKeyBuilder' &&
        Array.isArray(config.columns)
      ) {
        // deno-lint-ignore no-explicit-any
        const columnNames = config.columns.map((col: any) =>
          col.name as string
        );
        if (columnNames.every((name: unknown) => typeof name === 'string')) {
          return columnNames;
        }
      }
    }
  } catch {
    // Skip if builder throws
  }

  return [];
}

/**
 * Introspect a single Drizzle column
 */
function introspectColumn(
  propertyName: string,
  column: AnyColumn,
  foreignKeys: Map<string, { table: string; column: string }>,
): IntrospectedColumn {
  const result: IntrospectedColumn = {
    propertyName,
    dbName: column.name,
    columnType: column.columnType,
    dataType: column.dataType,
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    isPrimaryKey: column.primary ?? false,
    isUnique: column.isUnique,
  };

  // Optional CMS metadata stored by our `$cms()` builder extension.
  // Drizzle carries `config` from builder → built column.
  const anyWithConfig = column as unknown as {
    config?: { cmsOptions?: CmsColumnOptions };
  };
  if (anyWithConfig.config?.cmsOptions) {
    result.cmsOptions = anyWithConfig.config.cmsOptions;
  }

  // Detect array columns - use dataType which is database-agnostic
  if (column.dataType === 'array') {
    result.isArray = true;
  }

  // Add maxLength for varchar - access via config
  const config = column as unknown as { config?: { length?: number } };
  if (config.config?.length !== undefined) {
    result.maxLength = config.config.length;
  }

  // Add enum info
  if (column.enumValues) {
    result.enumValues = column.enumValues;
  }
  // Check for enum object with name (Postgres enums)
  const enumObj = column as unknown as {
    enum?: { enumName: string; enumValues: readonly string[] };
  };
  if (enumObj.enum?.enumName) {
    result.enumName = enumObj.enum.enumName;
    if (!result.enumValues && enumObj.enum.enumValues) {
      result.enumValues = enumObj.enum.enumValues;
    }
  }

  // Add foreign key reference
  const ref = foreignKeys.get(column.name);
  if (ref) {
    result.references = ref;
  }

  return result;
}

/**
 * Introspect a Drizzle table and extract metadata for all columns
 *
 * @param table - A Drizzle table object (e.g., `users` from your schema)
 * @returns Structured metadata about the table and its columns
 *
 * @example
 * ```ts
 * import { users } from './schema';
 * const metadata = introspectTable(users);
 * console.log(metadata.name); // 'users'
 * console.log(metadata.columns[0].name); // 'id'
 * ```
 */
export function introspectTable(table: Table): IntrospectedTable {
  // Validate input
  if (!table || typeof table !== 'object') {
    throw new Error(
      `Invalid Drizzle table: expected a table object, received ${typeof table}`,
    );
  }

  // Check if this looks like a Drizzle table
  if (!isTable(table)) {
    throw new Error(
      `Invalid Drizzle table: the provided object is not a valid Drizzle table. ` +
        `Make sure you're passing a table created with pgTable(), mysqlTable(), or sqliteTable().`,
    );
  }

  // Get table name using Drizzle's helper
  const tableName = getTableName(table);
  if (!tableName) {
    throw new Error(
      `Invalid Drizzle table: table name could not be extracted. ` +
        `The table may be malformed or missing its Symbol('drizzle:Name') property.`,
    );
  }

  // Extract foreign key references
  const foreignKeys = extractForeignKeys(table);

  // Extract composite primary key (if any)
  const compositePK = extractCompositePrimaryKey(table);

  // Get columns using Drizzle's helper
  const columns: IntrospectedColumn[] = [];
  const primaryKeys: string[] = [];

  const columnsObj = getTableColumns(table);

  for (const [key, value] of Object.entries(columnsObj)) {
    // Skip non-column properties
    if (!isDrizzleColumn(value)) continue;

    const column = introspectColumn(key, value, foreignKeys);

    // Mark columns as primary if they are part of a composite PK. The extra
    // config builder only exposes database names, so match on dbName here and
    // record the property name like every other identifier the CMS uses.
    if (compositePK.includes(column.dbName)) {
      column.isPrimaryKey = true;
    }

    columns.push(column);

    if (column.isPrimaryKey) {
      primaryKeys.push(column.propertyName);
    }
  }

  // Extract table-level CMS options if present
  // deno-lint-ignore no-explicit-any
  const cmsOptions = (table as any)[CMS_TABLE_OPTIONS] as
    | CmsTableOptions
    | undefined;

  const result: IntrospectedTable = {
    name: tableName,
    columns,
    primaryKey: primaryKeys,
    table, // Reference to original Drizzle table for query building
  };

  if (cmsOptions) {
    result.cmsOptions = cmsOptions;
  }

  return result;
}

/**
 * Introspect multiple tables from a schema object
 *
 * @param schema - An object containing Drizzle tables
 * @returns Array of introspected tables
 *
 * @example
 * ```ts
 * import * as schema from './schema';
 * const tables = introspectSchema(schema);
 * ```
 */
export function introspectSchema(
  schema: Record<string, unknown>,
): IntrospectedTable[] {
  const tables: IntrospectedTable[] = [];

  for (const value of Object.values(schema)) {
    // Check if this is a Drizzle table using the exported helper
    if (isTable(value)) {
      tables.push(introspectTable(value));
    }
  }

  return tables;
}

/**
 * Extract relations from a schema using Drizzle's helper
 *
 * @param schema - An object containing Drizzle tables and relations
 * @returns Array of introspected relations
 *
 * @example
 * ```ts
 * import * as schema from './schema';
 * const relations = introspectRelations(schema);
 * ```
 */
export function introspectRelations(
  schema: Record<string, unknown>,
): IntrospectedRelation[] {
  const result: IntrospectedRelation[] = [];

  try {
    const config = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    );

    for (const [tableName, tableConfig] of Object.entries(config.tables)) {
      // deno-lint-ignore no-explicit-any
      const relations = (tableConfig as any).relations || {};

      for (const [relationName, relation] of Object.entries(relations)) {
        // deno-lint-ignore no-explicit-any
        const rel = relation as any;
        const relationType = rel.constructor?.name === 'One' ? 'one' : 'many';

        result.push({
          name: relationName,
          sourceTable: tableName,
          targetTable: rel.referencedTableName,
          type: relationType,
          // Note: field mappings are available via rel.config if defined
        });
      }
    }
  } catch {
    // Schema may not have relations defined, return empty array
  }

  return result;
}

/**
 * Detect junction tables (many-to-many link tables) from introspected tables
 *
 * A junction table is identified by:
 * - Having exactly 2 FK columns pointing to different tables
 * - Having a composite primary key of those 2 columns (or no other data columns)
 * - Few/no other columns besides FKs and timestamps
 *
 * @param tables - Array of introspected tables
 * @returns Array of detected junction tables
 */
export function detectJunctionTables(
  tables: IntrospectedTable[],
): JunctionTable[] {
  const junctions: JunctionTable[] = [];

  for (const table of tables) {
    // Get FK columns
    const fkColumns = table.columns.filter((c) => c.references);

    // Must have exactly 2 FK columns pointing to different tables
    if (fkColumns.length !== 2) continue;

    const [fk1, fk2] = fkColumns;
    if (!fk1?.references || !fk2?.references) continue;

    // Must point to different tables
    if (fk1.references.table === fk2.references.table) continue;

    // Check if this looks like a junction (few other columns)
    // Allow: FKs + timestamps (created_at, updated_at) + maybe an order column
    const nonFkColumns = table.columns.filter((c) => !c.references);
    const allowedExtraColumns = [
      'created_at',
      'createdAt',
      'updated_at',
      'updatedAt',
      'order',
      'position',
      'sort_order',
      'sortOrder',
      'id',
    ];
    const hasOnlyAllowedExtras = nonFkColumns.every((c) =>
      allowedExtraColumns.includes(c.propertyName) ||
      allowedExtraColumns.includes(c.dbName) || c.isPrimaryKey
    );

    if (!hasOnlyAllowedExtras) continue;

    // Check if PKs match the FK columns (composite PK) or it's a simple junction
    const pkColumns = table.primaryKey;
    const fkNames = [fk1.propertyName, fk2.propertyName];
    const isCompositePK = pkColumns.length === 2 &&
      pkColumns.every((pk) => fkNames.includes(pk));
    const hasSimplePK = pkColumns.length <= 1;

    if (!isCompositePK && !hasSimplePK) continue;

    // Sort tables alphabetically for consistent ordering
    const sorted = [fk1, fk2].sort((a, b) =>
      a.references!.table.localeCompare(b.references!.table)
    );
    const left = sorted[0]!;
    const right = sorted[1]!;

    junctions.push({
      tableName: table.name,
      leftTable: left.references!.table,
      leftColumn: left.propertyName,
      rightTable: right.references!.table,
      rightColumn: right.propertyName,
    });
  }

  return junctions;
}

/**
 * Fully introspect a schema including tables and relations
 *
 * @param schema - An object containing Drizzle tables and relations
 * @returns Full schema introspection with tables and relations
 *
 * @example
 * ```ts
 * import * as schema from './schema';
 * const { tables, relations } = introspectFullSchema(schema);
 * ```
 */
export function introspectFullSchema(
  schema: Record<string, unknown>,
): IntrospectedSchema {
  const tables = introspectSchema(schema);
  const junctions = detectJunctionTables(tables);

  // Mark junction tables
  const junctionNames = new Set(junctions.map((j) => j.tableName));
  for (const table of tables) {
    if (junctionNames.has(table.name)) {
      table.isJunction = true;
    }
  }

  return {
    tables,
    relations: introspectRelations(schema),
    junctions,
  };
}
