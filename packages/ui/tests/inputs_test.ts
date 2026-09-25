// Tests for form input components

import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  booleanInput,
  checkboxListInput,
  dateInput,
  datetimeInput,
  fileInput,
  hiddenInput,
  jsonInput,
  manyToManyField,
  numberInput,
  relationInput,
  renderFieldInput,
  selectInput,
  textareaInput,
  textInput,
  uuidInput,
} from '../forms/inputs.ts';
import type { CMSField, IntrospectedColumn } from '@hotsauce/core';

// Helper to create mock CMSField
function createMockField(overrides: Partial<CMSField> = {}): CMSField {
  const column: IntrospectedColumn = {
    name: 'test_field',
    propertyName: 'testField',
    dataType: 'string',
    columnType: 'PgVarchar',
    notNull: true,
    hasDefault: false,
    isPrimaryKey: false,
    isUnique: false,
    ...overrides.column,
  };

  return {
    column,
    fieldType: 'text',
    label: 'Test Field',
    ...overrides,
  };
}

// textInput tests
Deno.test('textInput: renders basic text input', () => {
  const field = createMockField();
  const result = textInput(field);

  assertStringIncludes(result, 'type="text"');
  assertStringIncludes(result, 'name="testField"');
  assertStringIncludes(result, 'class="cms-input cms-input-text"');
});

Deno.test('textInput: includes value', () => {
  const field = createMockField();
  const result = textInput(field, { value: 'Hello' });

  assertStringIncludes(result, 'value="Hello"');
});

Deno.test('textInput: escapes value', () => {
  const field = createMockField();
  const result = textInput(field, { value: '<script>' });

  assertStringIncludes(result, 'value="&lt;script&gt;"');
});

Deno.test('textInput: adds required attribute', () => {
  const field = createMockField({
    column: { notNull: true, hasDefault: false } as IntrospectedColumn,
  });
  const result = textInput(field);

  assertStringIncludes(result, 'required');
});

Deno.test('textInput: adds maxlength attribute', () => {
  const field = createMockField({
    column: { maxLength: 100 } as IntrospectedColumn,
  });
  const result = textInput(field);

  assertStringIncludes(result, 'maxlength="100"');
});

Deno.test('textInput: adds disabled attribute', () => {
  const field = createMockField();
  const result = textInput(field, { disabled: true });

  assertStringIncludes(result, 'disabled');
});

// textareaInput tests
Deno.test('textareaInput: renders textarea', () => {
  const field = createMockField({ fieldType: 'textarea' });
  const result = textareaInput(field, { value: 'Content' });

  assertStringIncludes(result, '<textarea');
  assertStringIncludes(result, 'name="testField"');
  assertStringIncludes(result, '>Content</textarea>');
});

// numberInput tests
Deno.test('numberInput: renders number input', () => {
  const field = createMockField({ fieldType: 'number' });
  const result = numberInput(field);

  assertStringIncludes(result, 'type="number"');
});

// booleanInput tests
Deno.test('booleanInput: renders checkbox', () => {
  const field = createMockField({ fieldType: 'boolean' });
  const result = booleanInput(field);

  assertStringIncludes(result, 'type="checkbox"');
  assertStringIncludes(result, 'value="true"');
});

Deno.test('booleanInput: adds checked when value is true', () => {
  const field = createMockField({ fieldType: 'boolean' });
  const result = booleanInput(field, { value: true });

  assertStringIncludes(result, 'checked');
});

// dateInput tests
Deno.test('dateInput: renders date input', () => {
  const field = createMockField({ fieldType: 'date' });
  const result = dateInput(field);

  assertStringIncludes(result, 'type="date"');
});

Deno.test('dateInput: formats Date object', () => {
  const field = createMockField({ fieldType: 'date' });
  const date = new Date('2024-06-15T12:00:00Z');
  const result = dateInput(field, { value: date });

  assertStringIncludes(result, 'value="2024-06-15"');
});

// datetimeInput tests
Deno.test('datetimeInput: renders datetime-local input', () => {
  const field = createMockField({ fieldType: 'datetime' });
  const result = datetimeInput(field);

  assertStringIncludes(result, 'type="datetime-local"');
});

// selectInput tests
Deno.test('selectInput: renders select with options', () => {
  const field = createMockField({
    fieldType: 'select',
    column: {
      name: 'status',
      propertyName: 'status',
      dataType: 'string',
      columnType: 'PgEnum',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      enumValues: ['draft', 'published', 'archived'],
    },
  });
  const result = selectInput(field);

  assertStringIncludes(result, '<select');
  assertStringIncludes(result, '<option');
  assertStringIncludes(result, 'value="draft"');
  assertStringIncludes(result, 'value="published"');
  assertStringIncludes(result, 'value="archived"');
});

Deno.test('selectInput: marks selected option', () => {
  const field = createMockField({
    fieldType: 'select',
    column: {
      name: 'choice',
      propertyName: 'choice',
      dataType: 'string',
      columnType: 'PgEnum',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      enumValues: ['a', 'b', 'c'],
    },
  });
  const result = selectInput(field, { value: 'b' });

  assertStringIncludes(result, 'value="b" selected');
});

// uuidInput tests
Deno.test('uuidInput: renders with UUID pattern', () => {
  const field = createMockField({ fieldType: 'uuid' });
  const result = uuidInput(field);

  assertStringIncludes(result, 'type="text"');
  assertStringIncludes(result, 'pattern=');
});

// jsonInput tests
Deno.test('jsonInput: renders textarea for JSON', () => {
  const field = createMockField({ fieldType: 'json' });
  const result = jsonInput(field, { value: { key: 'value' } });

  assertStringIncludes(result, '<textarea');
  assertStringIncludes(result, 'cms-json');
  // JSON gets escaped - quotes become &quot;
  assertStringIncludes(result, '&quot;key&quot;');
});

// hiddenInput tests
Deno.test('hiddenInput: renders hidden input', () => {
  const field = createMockField();
  const result = hiddenInput(field, { value: 'secret' });

  assertStringIncludes(result, 'type="hidden"');
  assertStringIncludes(result, 'value="secret"');
});

Deno.test('fileInput: uses nested file config options', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      name: 'avatar',
      propertyName: 'avatar',
      dataType: 'json',
      columnType: 'PgJsonb',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      cmsOptions: {
        file: {
          accept: 'application/pdf',
          maxSize: 1_024,
        },
      },
    } as IntrospectedColumn,
  });

  const result = fileInput(field);
  assertStringIncludes(result, 'accept="application/pdf"');
  assertStringIncludes(result, 'Max size: 1KB. Accepted: application/pdf');
});

Deno.test('fileInput: does not preview SVG by default', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      name: 'icon',
      propertyName: 'icon',
      dataType: 'json',
      columnType: 'PgJsonb',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      cmsOptions: { file: true },
    } as IntrospectedColumn,
  });

  const result = fileInput(field, {
    value: {
      filename: 'icon.svg',
      contentType: 'image/svg+xml',
      size: 123,
      url: 'https://cdn.example.com/icon.svg',
    },
  });

  assertEquals(result.includes('cms-file-preview'), false);
  assertEquals(result.includes('<img'), false);
});

Deno.test('fileInput: previews SVG when file.previewSvg is true', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      name: 'icon',
      propertyName: 'icon',
      dataType: 'json',
      columnType: 'PgJsonb',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      cmsOptions: { file: { previewSvg: true } },
    } as IntrospectedColumn,
  });

  const result = fileInput(field, {
    value: {
      filename: 'icon.svg',
      contentType: 'image/svg+xml',
      size: 123,
      url: 'https://cdn.example.com/icon.svg',
    },
  });

  assertStringIncludes(result, 'cms-file-preview');
  assertStringIncludes(result, '<img');
});

// renderFieldInput tests
Deno.test('renderFieldInput: renders hidden for hidden fields', () => {
  const field = createMockField({ hidden: true });
  const result = renderFieldInput(field, { value: 'test' });

  assertStringIncludes(result, 'type="hidden"');
});

Deno.test('renderFieldInput: disables readonly fields', () => {
  const field = createMockField({ readOnly: true });
  const result = renderFieldInput(field);

  assertStringIncludes(result, 'disabled');
});

Deno.test('renderFieldInput: routes to correct input by fieldType', () => {
  assertEquals(
    renderFieldInput(createMockField({ fieldType: 'text' })).includes(
      'type="text"',
    ),
    true,
  );
  assertEquals(
    renderFieldInput(createMockField({ fieldType: 'textarea' })).includes(
      '<textarea',
    ),
    true,
  );
  assertEquals(
    renderFieldInput(createMockField({ fieldType: 'number' })).includes(
      'type="number"',
    ),
    true,
  );
  assertEquals(
    renderFieldInput(createMockField({ fieldType: 'boolean' })).includes(
      'type="checkbox"',
    ),
    true,
  );
});

// relationInput tests
Deno.test('relationInput: renders select element', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = relationInput(field);

  assertStringIncludes(result, '<select');
  assertStringIncludes(result, 'name="authorId"');
  assertStringIncludes(result, 'class="cms-input cms-select cms-relation"');
});

Deno.test('relationInput: shows placeholder with table name', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = relationInput(field);

  assertStringIncludes(result, '-- Select users --');
});

Deno.test('relationInput: renders options from relationOptions', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = relationInput(field, {
    relationOptions: [
      { value: 1, label: 'Alice' },
      { value: 2, label: 'Bob' },
    ],
  });

  assertStringIncludes(result, '<option');
  assertStringIncludes(result, 'value="1"');
  assertStringIncludes(result, '>Alice</option>');
  assertStringIncludes(result, 'value="2"');
  assertStringIncludes(result, '>Bob</option>');
});

Deno.test('relationInput: marks selected option', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = relationInput(field, {
    value: 2,
    relationOptions: [
      { value: 1, label: 'Alice' },
      { value: 2, label: 'Bob' },
    ],
  });

  assertStringIncludes(result, 'value="2" selected');
});

Deno.test('relationInput: adds required for notNull fields', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = relationInput(field);

  assertStringIncludes(result, 'required');
});

Deno.test('renderFieldInput: routes relation to relationInput', () => {
  const field = createMockField({
    fieldType: 'relation',
    column: {
      name: 'author_id',
      propertyName: 'authorId',
      dataType: 'number',
      columnType: 'PgInteger',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      references: { table: 'users', column: 'id' },
    },
  });
  const result = renderFieldInput(field, {
    relationOptions: [
      { value: 1, label: 'Alice' },
    ],
  });

  assertStringIncludes(result, '<select');
  assertStringIncludes(result, '>Alice</option>');
});

// checkboxListInput tests
Deno.test('checkboxListInput: renders checkbox list', () => {
  const result = checkboxListInput({
    name: 'categoryIds',
    label: 'Categories',
    options: [
      { value: 1, label: 'Tech' },
      { value: 2, label: 'News' },
    ],
  });

  assertStringIncludes(result, '<div');
  assertStringIncludes(result, 'class="cms-checkbox-list"');
  assertStringIncludes(result, 'type="checkbox"');
});

Deno.test('checkboxListInput: renders all options', () => {
  const result = checkboxListInput({
    name: 'categoryIds',
    label: 'Categories',
    options: [
      { value: 1, label: 'Tech' },
      { value: 2, label: 'News' },
      { value: 3, label: 'Sports' },
    ],
  });

  assertStringIncludes(result, '>Tech</span>');
  assertStringIncludes(result, '>News</span>');
  assertStringIncludes(result, '>Sports</span>');
});

Deno.test('checkboxListInput: marks selected options', () => {
  const result = checkboxListInput({
    name: 'categoryIds',
    label: 'Categories',
    options: [
      { value: 1, label: 'Tech' },
      { value: 2, label: 'News' },
    ],
    selectedValues: [2],
  });

  // Should have one checked checkbox (News)
  assertStringIncludes(result, 'value="2" checked');
  // Tech should not be checked
  assertEquals(result.includes('value="1" checked'), false);
});

Deno.test('checkboxListInput: handles empty options', () => {
  const result = checkboxListInput({
    name: 'categoryIds',
    label: 'Categories',
    options: [],
  });

  assertStringIncludes(result, 'cms-checkbox-list-empty');
  assertStringIncludes(result, 'No categories available');
});

Deno.test('checkboxListInput: uses correct name attribute', () => {
  const result = checkboxListInput({
    name: 'tagIds',
    label: 'Tags',
    options: [{ value: 1, label: 'Tag1' }],
  });

  assertStringIncludes(result, 'name="tagIds"');
});

Deno.test('checkboxListInput: generates unique ids', () => {
  const result = checkboxListInput({
    name: 'categoryIds',
    id: 'cats',
    label: 'Categories',
    options: [
      { value: 1, label: 'Tech' },
      { value: 2, label: 'News' },
    ],
  });

  assertStringIncludes(result, 'id="cats-0"');
  assertStringIncludes(result, 'id="cats-1"');
});

// manyToManyField tests
Deno.test('manyToManyField: renders field wrapper with label', () => {
  const result = manyToManyField({
    fieldName: 'categoryIds',
    label: 'Categories',
    relatedTable: 'categories',
    options: [{ value: 1, label: 'Tech' }],
    selectedValues: [],
  });

  assertStringIncludes(result, 'class="cms-field"');
  assertStringIncludes(result, 'class="cms-label"');
  assertStringIncludes(result, '>Categories</label>');
});

Deno.test('manyToManyField: includes checkbox list', () => {
  const result = manyToManyField({
    fieldName: 'tagIds',
    label: 'Tags',
    relatedTable: 'tags',
    options: [
      { value: 1, label: 'JavaScript' },
      { value: 2, label: 'TypeScript' },
    ],
    selectedValues: [2],
  });

  assertStringIncludes(result, 'class="cms-checkbox-list');
  assertStringIncludes(result, 'name="tagIds"');
  assertStringIncludes(result, '>JavaScript</span>');
  assertStringIncludes(result, '>TypeScript</span>');
  assertStringIncludes(result, 'value="2" checked');
});

Deno.test('manyToManyField: handles empty options', () => {
  const result = manyToManyField({
    fieldName: 'categoryIds',
    label: 'Categories',
    relatedTable: 'categories',
    options: [],
    selectedValues: [],
  });

  assertStringIncludes(result, 'class="cms-field"');
  assertStringIncludes(result, 'No categories available');
});

Deno.test('fileInput: renders Delete button for an editable nullable file field', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      name: 'avatar',
      propertyName: 'avatar',
      dataType: 'json',
      columnType: 'PgJsonb',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      cmsOptions: { file: true },
    } as IntrospectedColumn,
  });
  const value = {
    filename: 'photo.png',
    contentType: 'image/png',
    size: 10,
  };
  const result = fileInput(field, { value });
  assertStringIncludes(result, 'name="_clear_avatar"');
});

Deno.test('fileInput: omits Delete button when the field is disabled', () => {
  const field = createMockField({
    fieldType: 'file',
    column: {
      name: 'avatar',
      propertyName: 'avatar',
      dataType: 'json',
      columnType: 'PgJsonb',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
      cmsOptions: { file: true },
    } as IntrospectedColumn,
  });
  const value = {
    filename: 'photo.png',
    contentType: 'image/png',
    size: 10,
  };
  const result = fileInput(field, { value, disabled: true });
  assertStringIncludes(result, 'photo.png');
  assertEquals(result.includes('_clear_avatar'), false);
});
