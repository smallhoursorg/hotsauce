// Field type mapping from Drizzle column types to CMS field types

import type { IntrospectedColumn } from '../schema/types.ts';

/**
 * CMS field types that map to UI components
 */
export type CMSFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'select'
  | 'relation'
  | 'file'
  | 'json'
  | 'uuid'
  | 'array';

/**
 * CMS field definition with UI hints
 */
export interface CMSField {
  /** Original column metadata */
  column: IntrospectedColumn;

  /** CMS field type for UI rendering */
  fieldType: CMSFieldType;

  /** Human-readable label (derived from property name) */
  label: string;

  /** Placeholder text for input */
  placeholder?: string;

  /** Help text for the field */
  helpText?: string;

  /** Whether this field should be hidden in forms */
  hidden?: boolean;

  /** Whether this field is read-only */
  readOnly?: boolean;

  /** Whether this field is the thumbnail for grid views */
  thumbnail?: boolean;
}

/**
 * Convert a property name to a human-readable label. Handles camelCase and
 * snake_case, since property names may follow either convention.
 * e.g., "authorId" -> "Author Id", "created_at" -> "Created At"
 */
export function propertyNameToLabel(propertyName: string): string {
  return propertyName
    .replace(/_+/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\S/g, (s) => s.toUpperCase());
}

const AUDIT_TIMESTAMP_NAMES = new Set([
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt',
]);

/**
 * Whether a column is a conventional audit timestamp (`createdAt` /
 * `updatedAt`, in either camelCase or snake_case form). These are treated as
 * database-managed: read-only in forms and never written from user input.
 */
export function isAuditTimestampColumn(column: IntrospectedColumn): boolean {
  return AUDIT_TIMESTAMP_NAMES.has(column.propertyName) ||
    AUDIT_TIMESTAMP_NAMES.has(column.dbName);
}

/**
 * Map a Drizzle column type to a CMS field type
 */
export function mapColumnToFieldType(column: IntrospectedColumn): CMSFieldType {
  // Allow schema authors to override via `$cms()` metadata.
  if (column.cmsOptions?.file) {
    return 'file';
  }

  // Check for array first
  if (column.isArray) {
    return 'array';
  }

  // Check for foreign key reference
  if (column.references) {
    return 'relation';
  }

  // Check for enum
  if (column.enumValues) {
    return 'select';
  }

  // Check for UUID first (before general string mapping)
  if (/uuid/i.test(column.columnType)) {
    return 'uuid';
  }

  // Primary mapping based on dataType (database-agnostic)
  const dataTypeMap: Record<string, CMSFieldType> = {
    string: 'text',
    number: 'number',
    boolean: 'boolean',
    date: 'datetime',
    json: 'json',
    bigint: 'number',
  };

  const fromDataType = dataTypeMap[column.dataType];
  if (fromDataType) {
    // Refine text fields - check if it's a long text type
    if (fromDataType === 'text') {
      // columnType patterns for long text (database-agnostic patterns)
      const longTextPatterns = /Text|Clob|MediumText|LongText/i;
      if (longTextPatterns.test(column.columnType)) {
        // If column has a short maxLength (≤255), treat as short text (shows in list views)
        // This handles SQLite where all text columns are SQLiteText regardless of length
        if (column.maxLength !== undefined && column.maxLength <= 255) {
          return 'text';
        }
        return 'textarea';
      }
    }

    // Refine date fields - check for date-only vs datetime
    if (fromDataType === 'datetime') {
      const dateOnlyPatterns = /^(Pg|MySQL|SQLite)?Date$/i;
      if (dateOnlyPatterns.test(column.columnType)) {
        return 'date';
      }
    }

    return fromDataType;
  }

  // Default to text
  return 'text';
}

/**
 * Map an introspected column to a CMS field definition
 */
export function mapColumnToField(column: IntrospectedColumn): CMSField {
  const fieldType = mapColumnToFieldType(column);
  const label = propertyNameToLabel(column.propertyName);

  const field: CMSField = {
    column,
    fieldType,
    label,
  };

  // Apply $cms() options
  if (column.cmsOptions?.hidden) {
    field.hidden = true;
  }
  if (column.cmsOptions?.readOnly) {
    field.readOnly = true;
  }
  if (column.cmsOptions?.thumbnail) {
    field.thumbnail = true;
  }

  // Auto-hide columns with role: 'output' (computed by plugins)
  // Check all plugins for role: 'output'
  const plugins = column.cmsOptions?.plugins;
  if (plugins) {
    for (const pluginConfig of Object.values(plugins)) {
      if (
        pluginConfig && typeof pluginConfig === 'object' &&
        (pluginConfig as { role?: string }).role === 'output'
      ) {
        field.hidden = true;
        break;
      }
    }
  }

  // Auto-hide primary keys and timestamps
  if (column.isPrimaryKey) {
    field.hidden = true;
    field.readOnly = true;
  }

  // Common timestamp fields should be read-only
  if (isAuditTimestampColumn(column)) {
    field.readOnly = true;
  }

  // Add placeholder for text fields
  if (fieldType === 'text' && column.maxLength) {
    field.placeholder = `Max ${column.maxLength} characters`;
  }

  return field;
}

/**
 * Map all columns from an introspected table to CMS fields
 */
export function mapColumnsToFields(
  columns: IntrospectedColumn[],
): CMSField[] {
  return columns.map(mapColumnToField);
}

/**
 * Find the thumbnail field from a list of CMS fields.
 * Returns the first field with `thumbnail: true`, or undefined.
 */
export function getThumbnailField(fields: CMSField[]): CMSField | undefined {
  return fields.find((f) => f.thumbnail);
}
