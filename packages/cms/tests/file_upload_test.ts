// Tests for file upload utilities

import { assertEquals, assertExists } from '@std/assert';
import {
  arrayBufferToBase64,
  base64ToUint8Array,
  matchesAcceptPattern,
  parseMultipartFormData,
} from '../http.ts';
import type { IntrospectedColumn } from '@hotsauce/core';

// =============================================================================
// matchesAcceptPattern tests
// =============================================================================

Deno.test('matchesAcceptPattern: matches exact type', () => {
  assertEquals(matchesAcceptPattern('image/png', 'image/png'), true);
});

Deno.test('matchesAcceptPattern: matches wildcard', () => {
  assertEquals(matchesAcceptPattern('image/png', 'image/*'), true);
  assertEquals(matchesAcceptPattern('image/jpeg', 'image/*'), true);
  assertEquals(matchesAcceptPattern('image/gif', 'image/*'), true);
});

Deno.test('matchesAcceptPattern: rejects non-matching wildcard', () => {
  assertEquals(matchesAcceptPattern('application/pdf', 'image/*'), false);
  assertEquals(matchesAcceptPattern('text/plain', 'image/*'), false);
});

Deno.test('matchesAcceptPattern: matches */*', () => {
  assertEquals(matchesAcceptPattern('image/png', '*/*'), true);
  assertEquals(matchesAcceptPattern('application/pdf', '*/*'), true);
  assertEquals(matchesAcceptPattern('text/plain', '*/*'), true);
});

Deno.test('matchesAcceptPattern: matches */* inside a comma-separated list', () => {
  assertEquals(matchesAcceptPattern('image/png', 'application/pdf,*/*'), true);
  assertEquals(matchesAcceptPattern('text/plain', 'image/*, */*'), true);
});

Deno.test('matchesAcceptPattern: matches comma-separated patterns', () => {
  assertEquals(
    matchesAcceptPattern('image/png', 'image/png, image/jpeg'),
    true,
  );
  assertEquals(
    matchesAcceptPattern('image/jpeg', 'image/png, image/jpeg'),
    true,
  );
  assertEquals(
    matchesAcceptPattern('image/gif', 'image/png, image/jpeg'),
    false,
  );
});

Deno.test('matchesAcceptPattern: matches mixed exact and wildcard', () => {
  assertEquals(
    matchesAcceptPattern('application/pdf', 'image/*, application/pdf'),
    true,
  );
  assertEquals(
    matchesAcceptPattern('image/png', 'image/*, application/pdf'),
    true,
  );
  assertEquals(
    matchesAcceptPattern('text/plain', 'image/*, application/pdf'),
    false,
  );
});

Deno.test('matchesAcceptPattern: is case-insensitive', () => {
  assertEquals(matchesAcceptPattern('IMAGE/PNG', 'image/png'), true);
  assertEquals(matchesAcceptPattern('image/png', 'IMAGE/PNG'), true);
  assertEquals(matchesAcceptPattern('Image/Png', 'IMAGE/*'), true);
});

// =============================================================================
// base64 conversion tests
// =============================================================================

Deno.test('arrayBufferToBase64: converts empty buffer', () => {
  const buffer = new ArrayBuffer(0);
  assertEquals(arrayBufferToBase64(buffer), '');
});

Deno.test('arrayBufferToBase64: converts simple data', () => {
  const text = 'Hello';
  const encoder = new TextEncoder();
  const buffer = encoder.encode(text).buffer;
  // "Hello" in base64 is "SGVsbG8="
  assertEquals(arrayBufferToBase64(buffer), 'SGVsbG8=');
});

Deno.test('base64ToUint8Array: converts back correctly', () => {
  const original = 'SGVsbG8='; // "Hello"
  const bytes = base64ToUint8Array(original);
  const decoder = new TextDecoder();
  assertEquals(decoder.decode(bytes), 'Hello');
});

Deno.test('base64 roundtrip: preserves binary data', () => {
  // Create some binary data (including bytes that aren't valid UTF-8)
  const original = new Uint8Array([0, 127, 128, 255, 1, 2, 3]);
  const base64 = arrayBufferToBase64(original.buffer);
  const restored = base64ToUint8Array(base64);
  assertEquals(restored, original);
});

// =============================================================================
// parseMultipartFormData tests
// =============================================================================

// Helper to create a mock file
function createMockFile(
  name: string,
  content: string,
  type: string,
): File {
  return new File([content], name, { type });
}

// Helper to create FormData with a file
function createFormDataWithFile(
  fieldName: string,
  file: File,
  additionalFields?: Record<string, string>,
): FormData {
  const formData = new FormData();
  formData.append(fieldName, file);
  if (additionalFields) {
    for (const [key, value] of Object.entries(additionalFields)) {
      formData.append(key, value);
    }
  }
  return formData;
}

// Helper to create a Request with FormData
function createMultipartRequest(formData: FormData): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    body: formData,
  });
}

// Mock file column
const mockFileColumn: IntrospectedColumn = {
  dbName: 'avatar',
  propertyName: 'avatar',
  columnType: 'PgJsonb',
  dataType: 'json',
  notNull: false,
  hasDefault: false,
  isPrimaryKey: false,
  isUnique: false,
  cmsOptions: { file: true },
};

const mockFileColumnWithLimits: IntrospectedColumn = {
  ...mockFileColumn,
  cmsOptions: { file: { maxSize: 100, accept: 'image/png' } },
};

Deno.test('parseMultipartFormData: parses file upload', async () => {
  const file = createMockFile('test.png', 'fake image data', 'image/png');
  const formData = createFormDataWithFile('avatar', file, {
    name: 'Test User',
  });
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  // Check fields
  assertEquals(result.fields.name, 'Test User');

  // Check file
  assertExists(result.files.avatar);
  assertEquals(result.files.avatar.filename, 'test.png');
  assertEquals(result.files.avatar.contentType, 'image/png');
  assertEquals(result.files.avatar.size, 15); // "fake image data".length
  assertExists(result.files.avatar.data);

  // No errors
  assertEquals(Object.keys(result.errors).length, 0);
});

Deno.test('parseMultipartFormData: skips empty file input', async () => {
  const formData = new FormData();
  formData.append('avatar', new File([], '', { type: '' }));
  formData.append('name', 'Test User');
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  // File should not be present (empty input skipped)
  assertEquals(result.files.avatar, undefined);
  assertEquals(result.fields.name, 'Test User');
  assertEquals(Object.keys(result.errors).length, 0);
});

Deno.test('parseMultipartFormData: rejects file exceeding maxSize', async () => {
  // Column has maxSize: 100
  const file = createMockFile('big.png', 'x'.repeat(150), 'image/png');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [
    mockFileColumnWithLimits,
  ]);

  // File should not be present
  assertEquals(result.files.avatar, undefined);

  // Should have error
  assertExists(result.errors.avatar);
  assertEquals(result.errors.avatar.includes('too large'), true);
});

Deno.test('parseMultipartFormData: rejects wrong content type', async () => {
  // Column accepts only image/png
  const file = createMockFile('doc.pdf', 'pdf content', 'application/pdf');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [
    mockFileColumnWithLimits,
  ]);

  // File should not be present
  assertEquals(result.files.avatar, undefined);

  // Should have error
  assertExists(result.errors.avatar);
  assertEquals(result.errors.avatar.includes('Invalid file type'), true);
});

Deno.test('parseMultipartFormData: handles multiple regular fields', async () => {
  const formData = new FormData();
  formData.append('name', 'Test');
  formData.append('email', 'test@example.com');
  formData.append('tags', 'a');
  formData.append('tags', 'b');
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, []);

  assertEquals(result.fields.name, 'Test');
  assertEquals(result.fields.email, 'test@example.com');
  assertEquals(result.fields.tags, ['a', 'b']);
});

Deno.test('parseMultipartFormData: ignores file not in fileColumns', async () => {
  const file = createMockFile('test.png', 'data', 'image/png');
  const formData = new FormData();
  formData.append('unknownField', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  // Should not have the file (column name doesn't match)
  assertEquals(result.files.unknownField, undefined);
  assertEquals(Object.keys(result.errors).length, 0);
});

// =============================================================================
// Content-type cross-validation tests (extension ↔ claimed MIME type)
// =============================================================================

Deno.test('parseMultipartFormData: rejects unrecognised file extension', async () => {
  const file = createMockFile(
    'data.xyz999',
    'content',
    'application/octet-stream',
  );
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  assertEquals(result.files.avatar, undefined);
  assertExists(result.errors.avatar);
  assertEquals(
    result.errors.avatar.includes('Unrecognised file extension'),
    true,
  );
});

Deno.test('parseMultipartFormData: rejects content-type mismatch', async () => {
  // Claim image/png but filename says .exe
  const file = createMockFile('malware.exe', 'content', 'image/png');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  assertEquals(result.files.avatar, undefined);
  assertExists(result.errors.avatar);
  assertEquals(result.errors.avatar.includes('Content type mismatch'), true);
});

Deno.test('parseMultipartFormData: .jpg with image/jpeg passes', async () => {
  const file = createMockFile('photo.jpg', 'img', 'image/jpeg');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  assertExists(result.files.avatar);
  assertEquals(result.files.avatar.contentType, 'image/jpeg');
  assertEquals(Object.keys(result.errors).length, 0);
});

Deno.test('parseMultipartFormData: .jpeg with image/jpeg passes', async () => {
  const file = createMockFile('photo.jpeg', 'img', 'image/jpeg');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  assertExists(result.files.avatar);
  assertEquals(Object.keys(result.errors).length, 0);
});

Deno.test('parseMultipartFormData: uppercase extension is validated', async () => {
  const file = createMockFile('photo.PNG', 'img', 'image/png');
  const formData = createFormDataWithFile('avatar', file);
  const request = createMultipartRequest(formData);

  const result = await parseMultipartFormData(request, [mockFileColumn]);

  assertExists(result.files.avatar);
  assertEquals(Object.keys(result.errors).length, 0);
});
