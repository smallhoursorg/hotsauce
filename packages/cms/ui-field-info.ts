/**
 * Convert CMSField to serializable UIFieldInfo for plugin hooks.
 *
 * Shared helper used by crud.ts and grid-helpers.ts to avoid drift.
 */

import type { CMSField } from '@hotsauce/core';
import type { Serializable, UIFieldInfo } from '@hotsauce/workers';

export function toUIFieldInfo(field: CMSField): UIFieldInfo {
  const plugins = field.column.cmsOptions?.plugins as
    | Record<string, unknown>
    | undefined;
  return {
    name: field.column.propertyName,
    dbName: field.column.dbName,
    label: field.label,
    fieldType: field.fieldType,
    columnType: field.column.columnType,
    required: field.column.notNull && !field.column.hasDefault,
    readOnly: field.readOnly ?? false,
    _plugins: plugins as Record<string, Serializable> | undefined,
  };
}
