// Tests for field mapping module

import { assertEquals } from '@std/assert';
import {
  getThumbnailField,
  isAuditTimestampColumn,
  mapColumnsToFields,
  mapColumnToField,
  mapColumnToFieldType,
  propertyNameToLabel,
} from '../fields/mapping.ts';
import type { IntrospectedColumn } from '../schema/types.ts';

// Helper to create mock columns
function createMockColumn(
  overrides: Partial<IntrospectedColumn>,
): IntrospectedColumn {
  return {
    dbName: 'test_column',
    propertyName: 'testColumn',
    dataType: 'string',
    columnType: 'PgVarchar',
    notNull: true,
    hasDefault: false,
    isPrimaryKey: false,
    isUnique: false,
    isArray: false,
    ...overrides,
  };
}

// propertyNameToLabel tests
Deno.test('propertyNameToLabel: converts snake_case property names too', () => {
  assertEquals(propertyNameToLabel('created_at'), 'Created At');
  assertEquals(propertyNameToLabel('sort_order'), 'Sort Order');
  assertEquals(propertyNameToLabel('id'), 'Id');
});

Deno.test('propertyNameToLabel: converts camelCase to Title Case', () => {
  assertEquals(propertyNameToLabel('authorId'), 'Author Id');
  assertEquals(propertyNameToLabel('createdAt'), 'Created At');
  assertEquals(propertyNameToLabel('firstName'), 'First Name');
});

Deno.test('propertyNameToLabel: handles single word', () => {
  assertEquals(propertyNameToLabel('name'), 'Name');
  assertEquals(propertyNameToLabel('email'), 'Email');
});

Deno.test('propertyNameToLabel: handles all caps acronyms', () => {
  assertEquals(propertyNameToLabel('userID'), 'User I D');
  assertEquals(propertyNameToLabel('htmlContent'), 'Html Content');
});

// mapColumnToFieldType tests
Deno.test('mapColumnToFieldType: string dataType maps to text', () => {
  const column = createMockColumn({ dataType: 'string' });
  assertEquals(mapColumnToFieldType(column), 'text');
});

Deno.test('mapColumnToFieldType: cmsOptions.file overrides to file', () => {
  const column = createMockColumn({
    dataType: 'json',
    cmsOptions: { file: true },
  });
  assertEquals(mapColumnToFieldType(column), 'file');
});

Deno.test('mapColumnToFieldType: number dataType maps to number', () => {
  const column = createMockColumn({ dataType: 'number' });
  assertEquals(mapColumnToFieldType(column), 'number');
});

Deno.test('mapColumnToFieldType: boolean dataType maps to boolean', () => {
  const column = createMockColumn({ dataType: 'boolean' });
  assertEquals(mapColumnToFieldType(column), 'boolean');
});

Deno.test('mapColumnToFieldType: date dataType maps to datetime by default', () => {
  const column = createMockColumn({
    dataType: 'date',
    columnType: 'PgTimestamp',
  });
  assertEquals(mapColumnToFieldType(column), 'datetime');
});

Deno.test('mapColumnToFieldType: date-only columns map to date', () => {
  const column = createMockColumn({ dataType: 'date', columnType: 'PgDate' });
  assertEquals(mapColumnToFieldType(column), 'date');
});

Deno.test('mapColumnToFieldType: json dataType maps to json', () => {
  const column = createMockColumn({ dataType: 'json' });
  assertEquals(mapColumnToFieldType(column), 'json');
});

Deno.test('mapColumnToFieldType: bigint dataType maps to number', () => {
  const column = createMockColumn({ dataType: 'bigint' });
  assertEquals(mapColumnToFieldType(column), 'number');
});

Deno.test('mapColumnToFieldType: column with references maps to relation', () => {
  const column = createMockColumn({
    dataType: 'number',
    references: { table: 'users', column: 'id' },
  });
  assertEquals(mapColumnToFieldType(column), 'relation');
});

Deno.test('mapColumnToFieldType: column with enumValues maps to select', () => {
  const column = createMockColumn({
    dataType: 'string',
    enumValues: ['draft', 'published', 'archived'],
  });
  assertEquals(mapColumnToFieldType(column), 'select');
});

Deno.test('mapColumnToFieldType: array column maps to array', () => {
  const column = createMockColumn({
    dataType: 'string',
    isArray: true,
  });
  assertEquals(mapColumnToFieldType(column), 'array');
});

Deno.test('mapColumnToFieldType: long text types map to textarea', () => {
  const textColumn = createMockColumn({
    dataType: 'string',
    columnType: 'PgText',
  });
  assertEquals(mapColumnToFieldType(textColumn), 'textarea');

  const clobColumn = createMockColumn({
    dataType: 'string',
    columnType: 'MySQLMediumText',
  });
  assertEquals(mapColumnToFieldType(clobColumn), 'textarea');

  const sqliteColumn = createMockColumn({
    dataType: 'string',
    columnType: 'SQLiteText',
  });
  assertEquals(mapColumnToFieldType(sqliteColumn), 'textarea');
});

Deno.test('mapColumnToFieldType: SQLite text with maxLength maps to text (not textarea)', () => {
  // SQLite uses SQLiteText for all text columns, but columns with a short maxLength
  // (e.g., title with 200 chars) should map to 'text' so they show in list views
  const shortTextColumn = createMockColumn({
    dataType: 'string',
    columnType: 'SQLiteText',
    maxLength: 200,
  });
  assertEquals(mapColumnToFieldType(shortTextColumn), 'text');

  // maxLength at boundary (255) should still be text
  const boundaryColumn = createMockColumn({
    dataType: 'string',
    columnType: 'SQLiteText',
    maxLength: 255,
  });
  assertEquals(mapColumnToFieldType(boundaryColumn), 'text');

  // maxLength > 255 should be textarea (too long for list view)
  const mediumTextColumn = createMockColumn({
    dataType: 'string',
    columnType: 'SQLiteText',
    maxLength: 500,
  });
  assertEquals(mapColumnToFieldType(mediumTextColumn), 'textarea');

  // But unlimited text (no maxLength) should still be textarea
  const longTextColumn = createMockColumn({
    dataType: 'string',
    columnType: 'SQLiteText',
    // no maxLength
  });
  assertEquals(mapColumnToFieldType(longTextColumn), 'textarea');
});

Deno.test('mapColumnToFieldType: uuid columns map to uuid', () => {
  const column = createMockColumn({
    dataType: 'string',
    columnType: 'PgUUID',
  });
  assertEquals(mapColumnToFieldType(column), 'uuid');
});

Deno.test('mapColumnToFieldType: unknown dataType defaults to text', () => {
  const column = createMockColumn({
    dataType: 'custom',
    columnType: 'CustomType',
  });
  assertEquals(mapColumnToFieldType(column), 'text');
});

// mapColumnToField tests
Deno.test('mapColumnToField: creates CMSField with correct properties', () => {
  const column = createMockColumn({
    dbName: 'first_name',
    propertyName: 'firstName',
    dataType: 'string',
  });

  const field = mapColumnToField(column);

  assertEquals(field.column, column);
  assertEquals(field.fieldType, 'text');
  assertEquals(field.label, 'First Name');
  assertEquals(field.hidden, undefined);
  assertEquals(field.readOnly, undefined);
});

Deno.test('mapColumnToField: hides primary key fields', () => {
  const column = createMockColumn({
    dbName: 'id',
    propertyName: 'id',
    dataType: 'number',
    isPrimaryKey: true,
  });

  const field = mapColumnToField(column);

  assertEquals(field.hidden, true);
  assertEquals(field.readOnly, true);
});

Deno.test('mapColumnToField: marks timestamp fields as read-only', () => {
  const createdAt = createMockColumn({
    dbName: 'created_at',
    propertyName: 'createdAt',
    dataType: 'date',
  });

  const updatedAt = createMockColumn({
    dbName: 'updated_at',
    propertyName: 'updatedAt',
    dataType: 'date',
  });

  assertEquals(mapColumnToField(createdAt).readOnly, true);
  assertEquals(mapColumnToField(updatedAt).readOnly, true);
});

Deno.test('isAuditTimestampColumn: matches on either the property name or the DB name', () => {
  // Property name is conventional, DB name is not
  assertEquals(
    isAuditTimestampColumn(
      createMockColumn({ propertyName: 'createdAt', dbName: 'creation_ts' }),
    ),
    true,
  );
  // DB name is conventional, property name is not
  assertEquals(
    isAuditTimestampColumn(
      createMockColumn({ propertyName: 'created', dbName: 'created_at' }),
    ),
    true,
  );
  // Neither
  assertEquals(
    isAuditTimestampColumn(
      createMockColumn({ propertyName: 'publishedAt', dbName: 'published_at' }),
    ),
    false,
  );
});

Deno.test('mapColumnToField: adds placeholder for text fields with maxLength', () => {
  const column = createMockColumn({
    dataType: 'string',
    maxLength: 100,
  });

  const field = mapColumnToField(column);

  assertEquals(field.placeholder, 'Max 100 characters');
});

Deno.test('mapColumnToField: no placeholder without maxLength', () => {
  const column = createMockColumn({
    dataType: 'string',
  });

  const field = mapColumnToField(column);

  assertEquals(field.placeholder, undefined);
});

// mapColumnsToFields tests
Deno.test('mapColumnsToFields: maps all columns to fields', () => {
  const columns: IntrospectedColumn[] = [
    createMockColumn({ propertyName: 'id', isPrimaryKey: true }),
    createMockColumn({ propertyName: 'name', dataType: 'string' }),
    createMockColumn({ propertyName: 'age', dataType: 'number' }),
  ];

  const fields = mapColumnsToFields(columns);

  assertEquals(fields.length, 3);
  assertEquals(fields[0]!.label, 'Id');
  assertEquals(fields[1]!.label, 'Name');
  assertEquals(fields[2]!.label, 'Age');
});

Deno.test('mapColumnsToFields: preserves field order', () => {
  const columns: IntrospectedColumn[] = [
    createMockColumn({ propertyName: 'zulu' }),
    createMockColumn({ propertyName: 'alpha' }),
    createMockColumn({ propertyName: 'mike' }),
  ];

  const fields = mapColumnsToFields(columns);

  assertEquals(fields[0]!.label, 'Zulu');
  assertEquals(fields[1]!.label, 'Alpha');
  assertEquals(fields[2]!.label, 'Mike');
});

Deno.test('mapColumnsToFields: returns empty array for empty columns', () => {
  const fields = mapColumnsToFields([]);
  assertEquals(fields.length, 0);
});

// $cms() options tests
Deno.test('mapColumnToField: cmsOptions.hidden sets hidden to true', () => {
  const column = createMockColumn({
    propertyName: 'contentHtml',
    dataType: 'string',
    cmsOptions: { hidden: true },
  });

  const field = mapColumnToField(column);

  assertEquals(field.hidden, true);
  assertEquals(field.readOnly, undefined);
});

Deno.test('mapColumnToField: cmsOptions.readOnly sets readOnly to true', () => {
  const column = createMockColumn({
    propertyName: 'computedScore',
    dataType: 'number',
    cmsOptions: { readOnly: true },
  });

  const field = mapColumnToField(column);

  assertEquals(field.readOnly, true);
  assertEquals(field.hidden, undefined);
});

Deno.test('mapColumnToField: multiple cmsOptions work together', () => {
  const column = createMockColumn({
    propertyName: 'internalNote',
    dataType: 'string',
    cmsOptions: {
      hidden: true,
      readOnly: true,
    },
  });

  const field = mapColumnToField(column);

  assertEquals(field.hidden, true);
  assertEquals(field.readOnly, true);
});

// thumbnail tests
Deno.test('mapColumnToField: thumbnail option is propagated', () => {
  const column = createMockColumn({
    propertyName: 'file',
    dataType: 'json',
    cmsOptions: { file: { accept: 'image/*' }, thumbnail: true },
  });

  const field = mapColumnToField(column);
  assertEquals(field.thumbnail, true);
});

Deno.test('mapColumnToField: thumbnail is undefined when not set', () => {
  const column = createMockColumn({
    propertyName: 'file',
    dataType: 'json',
    cmsOptions: { file: true },
  });

  const field = mapColumnToField(column);
  assertEquals(field.thumbnail, undefined);
});

Deno.test('getThumbnailField: returns the thumbnail field', () => {
  const fields = [
    mapColumnToField(
      createMockColumn({
        propertyName: 'id',
        isPrimaryKey: true,
        hasDefault: true,
      }),
    ),
    mapColumnToField(
      createMockColumn({
        propertyName: 'file',
        dataType: 'json',
        cmsOptions: { file: true, thumbnail: true },
      }),
    ),
    mapColumnToField(
      createMockColumn({ propertyName: 'alt', dataType: 'string' }),
    ),
  ];

  const thumb = getThumbnailField(fields);
  assertEquals(thumb?.column.propertyName, 'file');
});

Deno.test('getThumbnailField: returns undefined when no thumbnail', () => {
  const fields = [
    mapColumnToField(
      createMockColumn({
        propertyName: 'id',
        isPrimaryKey: true,
        hasDefault: true,
      }),
    ),
    mapColumnToField(
      createMockColumn({ propertyName: 'name', dataType: 'string' }),
    ),
  ];

  const thumb = getThumbnailField(fields);
  assertEquals(thumb, undefined);
});
