// Tests for form field wrapper component

import { assertStringIncludes } from '@std/assert';
import { formField } from '../forms/field.ts';
import type { CMSField, IntrospectedColumn } from '@hotsauce/core';

// Helper to create mock CMSField
function createMockField(
  overrides: Omit<Partial<CMSField>, 'column'> & {
    column?: Partial<IntrospectedColumn>;
  } = {},
): CMSField {
  const { column: columnOverrides, ...rest } = overrides;
  const column: IntrospectedColumn = {
    dbName: 'test_field',
    propertyName: 'testField',
    dataType: 'string',
    columnType: 'PgVarchar',
    notNull: false,
    hasDefault: false,
    isPrimaryKey: false,
    isUnique: false,
    ...columnOverrides,
  };

  return {
    column,
    fieldType: 'text',
    label: 'Test Field',
    ...rest,
  };
}

// valueSummary-only override tests

Deno.test('formField: valueSummary-only override renders summary for read-only field', () => {
  const field = createMockField({ readOnly: true });
  const result = formField(field, {
    value: '{"content":[1,2,3]}',
    override: { valueSummary: '3 blocks' },
  });

  assertStringIncludes(result, 'cms-value-summary');
  assertStringIncludes(result, '3 blocks');
  assertStringIncludes(result, 'cms-field-readonly');
});

Deno.test('formField: valueSummary-only override hides raw JSON input', () => {
  const field = createMockField({
    readOnly: true,
    fieldType: 'json',
  });
  const result = formField(field, {
    value: '{"content":[{"type":"heading"}]}',
    override: { valueSummary: '1 block' },
  });

  // Should show summary, not textarea with raw JSON
  assertStringIncludes(result, '1 block');
  // Should not contain the raw JSON value
  if (result.includes('{"content"')) {
    throw new Error(
      'Raw JSON should not be rendered when valueSummary is provided',
    );
  }
});

Deno.test('formField: valueSummary-only override replaces input for writable fields', () => {
  // This pattern is used by S3 storage plugin on create view:
  // "Save record first to upload files via S3"
  const field = createMockField({ readOnly: false });
  const result = formField(field, {
    value: 'test value',
    override: { valueSummary: 'Save record first to upload' },
  });

  // Should render the summary instead of input
  assertStringIncludes(result, 'cms-value-summary');
  assertStringIncludes(result, 'Save record first to upload');
  // Input should not be present
  if (result.includes('type="text"')) {
    throw new Error(
      'Text input should not render when valueSummary override is provided',
    );
  }
});

Deno.test('formField: valueSummary with link renders both for read-only field', () => {
  const field = createMockField({ readOnly: true });
  const result = formField(field, {
    value: '{}',
    override: {
      valueSummary: '5 blocks',
      link: { href: '/edit', label: 'Edit Content', target: '_blank' },
    },
  });

  assertStringIncludes(result, 'cms-value-summary');
  assertStringIncludes(result, '5 blocks');
  assertStringIncludes(result, 'href="/edit"');
  assertStringIncludes(result, 'Edit Content');
  assertStringIncludes(result, '↗'); // external link indicator
});

Deno.test('formField: valueSummary with link renders both for writable field', () => {
  const field = createMockField({ readOnly: false });
  const result = formField(field, {
    value: '{"content":[1,2,3]}',
    override: {
      valueSummary: '3 blocks',
      link: { href: '/puck/edit', label: 'Edit with Puck', target: '_blank' },
    },
  });

  // Should show summary (not raw JSON)
  assertStringIncludes(result, 'cms-value-summary');
  assertStringIncludes(result, '3 blocks');
  // Should show the link
  assertStringIncludes(result, 'href="/puck/edit"');
  assertStringIncludes(result, 'Edit with Puck');
  // Raw JSON should not appear
  if (result.includes('{"content"')) {
    throw new Error(
      'Raw JSON should not be rendered when valueSummary is provided',
    );
  }
});

Deno.test('formField: link-only override renders link without summary', () => {
  const field = createMockField({ readOnly: true });
  const result = formField(field, {
    value: 'some value',
    override: {
      link: { href: '/edit', label: 'Edit' },
    },
  });

  assertStringIncludes(result, 'href="/edit"');
  assertStringIncludes(result, 'Edit');
  // Should render disabled input since no valueSummary
  assertStringIncludes(result, 'disabled');
});

Deno.test('formField: fileUrl shows image preview for image contentType', () => {
  const field = createMockField({ readOnly: false });
  const result = formField(field, {
    value: {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 1024,
    },
    override: {
      link: { href: '/upload', label: 'Upload' },
      fileUrl: '/files/media/image/1',
    },
  });

  // Should show image preview with filename as alt text
  assertStringIncludes(result, '<img');
  assertStringIncludes(result, 'cms-file-preview');
  assertStringIncludes(result, '/files/media/image/1');
  assertStringIncludes(result, 'alt="photo.jpg"');
});

Deno.test('formField: fileUrl does NOT show image preview for non-image contentType', () => {
  const field = createMockField({ readOnly: false });
  const result = formField(field, {
    value: {
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      size: 2048,
    },
    override: {
      link: { href: '/upload', label: 'Upload' },
      fileUrl: '/files/media/document/1',
    },
  });

  // Should NOT show image preview for PDFs
  if (result.includes('<img')) {
    throw new Error('Image preview should not render for non-image files');
  }
  // But link should still be there
  assertStringIncludes(result, 'href="/upload"');
});

Deno.test('formField: does not preview SVG by default (XSS protection)', () => {
  const field = createMockField({ readOnly: false });
  const result = formField(field, {
    value: {
      filename: 'icon.svg',
      contentType: 'image/svg+xml',
      size: 512,
    },
    override: {
      link: { href: '/upload', label: 'Upload' },
      fileUrl: '/files/media/icon/1',
    },
  });

  // Should NOT show image preview for SVG by default
  if (result.includes('<img')) {
    throw new Error('SVG preview should not render without previewSvg opt-in');
  }
  // But link should still be there
  assertStringIncludes(result, 'href="/upload"');
});

Deno.test('formField: previews SVG when file.previewSvg is true', () => {
  const field = createMockField({
    readOnly: false,
    column: { cmsOptions: { file: { previewSvg: true } } },
  });
  const result = formField(field, {
    value: {
      filename: 'icon.svg',
      contentType: 'image/svg+xml',
      size: 512,
    },
    override: {
      link: { href: '/upload', label: 'Upload' },
      fileUrl: '/files/media/icon/1',
    },
  });

  // Should show image preview when previewSvg is true
  assertStringIncludes(result, '<img');
  assertStringIncludes(result, 'cms-file-preview');
  assertStringIncludes(result, '/files/media/icon/1');
});

Deno.test('formField: uses field label as fallback alt text when filename missing', () => {
  const field = createMockField({ readOnly: false, label: 'Profile Image' });
  const result = formField(field, {
    value: {
      contentType: 'image/png',
      size: 2048,
    },
    override: {
      link: { href: '/upload', label: 'Upload' },
      fileUrl: '/files/media/image/1',
    },
  });

  // Should use field label as fallback alt text
  assertStringIncludes(result, '<img');
  assertStringIncludes(result, 'alt="Profile Image preview"');
});
