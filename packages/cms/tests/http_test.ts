// Tests for utility functions

import { assertEquals, assertExists } from '@std/assert';
import {
  coerceFormValues,
  coerceValue,
  forbidden,
  getPagination,
  getSort,
  htmlResponse,
  jsonResponse,
  methodNotAllowed,
  notFound,
  parseFormData,
  readBodyWithLimit,
  redirect,
} from '../http.ts';
import { buildSecurityHeaders, contentDispositionHeader } from '../http.ts';
import type { IntrospectedColumn } from '@hotsauce/core';

// =============================================================================
// Response helper tests
// =============================================================================

Deno.test('htmlResponse: creates HTML response', () => {
  const response = htmlResponse('<p>Hello</p>');

  assertEquals(response.status, 200);
  assertEquals(
    response.headers.get('Content-Type'),
    'text/html; charset=utf-8',
  );
});

Deno.test('htmlResponse: custom status code', () => {
  const response = htmlResponse('<p>Error</p>', 500);

  assertEquals(response.status, 500);
});

Deno.test('htmlResponse: admin HTML is never cacheable', () => {
  const defaultHeaders = htmlResponse('<p>Hello</p>');
  assertEquals(
    defaultHeaders.headers.get('Cache-Control'),
    'no-store, max-age=0',
  );

  // Also when call sites pass the resolved security headers explicitly
  const resolved = htmlResponse('<p>Hello</p>', 200, buildSecurityHeaders());
  assertEquals(resolved.headers.get('Cache-Control'), 'no-store, max-age=0');
});

Deno.test('buildSecurityHeaders: includes no-store with custom CSP options', () => {
  const headers = buildSecurityHeaders({ imgSrc: ['https://cdn.example.com'] });
  assertEquals(headers['Cache-Control'], 'no-store, max-age=0');
});

Deno.test('redirect: creates redirect response', () => {
  const response = redirect('/admin/users');

  assertEquals(response.status, 303);
  assertEquals(response.headers.get('Location'), '/admin/users');
});

Deno.test('redirect: custom status code', () => {
  const response = redirect('/admin', 302);

  assertEquals(response.status, 302);
});

Deno.test('jsonResponse: creates JSON response', () => {
  const response = jsonResponse({ success: true });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get('Content-Type'), 'application/json');
});

Deno.test('notFound: creates 404 response', () => {
  const response = notFound('Page not found');

  assertEquals(response.status, 404);
});

Deno.test('notFound: escapes HTML in message to prevent XSS', async () => {
  const response = notFound('<script>alert("xss")</script>');
  const body = await response.text();

  assertEquals(response.status, 404);
  // Should escape HTML special characters
  assertEquals(body.includes('&lt;script&gt;'), true);
  assertEquals(body.includes('<script>'), false);
});

Deno.test('forbidden: creates 403 response', () => {
  const response = forbidden('Access denied');

  assertEquals(response.status, 403);
});

Deno.test('forbidden: escapes HTML in message to prevent XSS', async () => {
  const response = forbidden('<img src=x onerror=alert(1)>');
  const body = await response.text();

  assertEquals(response.status, 403);
  // Should escape HTML special characters
  assertEquals(body.includes('&lt;img'), true);
  assertEquals(body.includes('<img'), false);
});

Deno.test('methodNotAllowed: creates 405 response', () => {
  const response = methodNotAllowed(['GET', 'POST']);

  assertEquals(response.status, 405);
  assertEquals(response.headers.get('Allow'), 'GET, POST');
});

// =============================================================================
// coerceValue tests
// =============================================================================

Deno.test('coerceValue: string remains string', () => {
  assertEquals(coerceValue('hello', 'string'), 'hello');
});

Deno.test('coerceValue: number converts to number', () => {
  assertEquals(coerceValue('42', 'number'), 42);
});

Deno.test('coerceValue: invalid number returns null', () => {
  assertEquals(coerceValue('abc', 'number'), null);
});

Deno.test('coerceValue: bigint converts to integer', () => {
  assertEquals(coerceValue('123', 'bigint'), 123);
});

Deno.test('coerceValue: boolean true', () => {
  assertEquals(coerceValue('true', 'boolean'), true);
  assertEquals(coerceValue('1', 'boolean'), true);
  assertEquals(coerceValue('on', 'boolean'), true);
});

Deno.test('coerceValue: boolean false', () => {
  assertEquals(coerceValue('false', 'boolean'), false);
  assertEquals(coerceValue('0', 'boolean'), false);
});

Deno.test('coerceValue: json parses object', () => {
  const result = coerceValue('{"key": "value"}', 'json');
  assertEquals(result, { key: 'value' });
});

Deno.test('coerceValue: invalid json returns null', () => {
  assertEquals(coerceValue('not json', 'json'), null);
});

Deno.test('coerceValue: date returns string', () => {
  assertEquals(coerceValue('2024-01-15', 'date'), '2024-01-15');
});

Deno.test('coerceValue: empty string for non-string returns null', () => {
  assertEquals(coerceValue('', 'number'), null);
  assertEquals(coerceValue('', 'boolean'), null);
  assertEquals(coerceValue('', 'json'), null);
});

// =============================================================================
// coerceFormValues tests
// =============================================================================

Deno.test('coerceFormValues: converts form data based on column types', () => {
  const formData = {
    name: 'John',
    age: '30',
    active: 'true',
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'name',
      propertyName: 'name',
      columnType: 'PgVarchar',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'age',
      propertyName: 'age',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'active',
      propertyName: 'active',
      columnType: 'PgBoolean',
      dataType: 'boolean',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);

  assertEquals(result.name, 'John');
  assertEquals(result.age, 30);
  assertEquals(result.active, true);
});

Deno.test('coerceFormValues: handles nullable fields with empty values', () => {
  const formData = {
    bio: '',
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'bio',
      propertyName: 'bio',
      columnType: 'PgText',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);

  assertEquals(result.bio, null);
});

Deno.test('coerceFormValues: handles array values', () => {
  const formData = {
    tags: ['one', 'two'],
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'tags',
      propertyName: 'tags',
      columnType: 'PgVarchar',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);

  // Uses last value - supports hidden+checkbox pattern where
  // hidden sends 'false' and checked checkbox sends 'true' after it
  assertEquals(result.tags, 'two');
});

Deno.test('coerceFormValues: hidden+checkbox boolean pattern', () => {
  // HTML forms with hidden input fallback send both values when checkbox is checked:
  // <input type="hidden" name="published" value="false" />
  // <input type="checkbox" name="published" value="true" checked />
  // The array order is ['false', 'true'] - we must use the last value
  const formData = {
    published: ['false', 'true'], // Checkbox checked: hidden='false', checkbox='true'
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'published',
      propertyName: 'published',
      columnType: 'PgBoolean',
      dataType: 'boolean',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);
  assertEquals(result.published, true);
});

Deno.test('coerceFormValues: hidden+checkbox unchecked sends only false', () => {
  // When checkbox is unchecked, only the hidden input value is sent
  const formData = {
    published: 'false',
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'published',
      propertyName: 'published',
      columnType: 'PgBoolean',
      dataType: 'boolean',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);
  assertEquals(result.published, false);
});

Deno.test('coerceFormValues: uses propertyName for form lookup and output', () => {
  // Form uses camelCase (propertyName), Drizzle also expects propertyName
  const formData = {
    authorId: '42', // Form field uses propertyName
    createdAt: '2024-01-01',
  };

  const columns: IntrospectedColumn[] = [
    {
      dbName: 'author_id',
      propertyName: 'authorId',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
    {
      dbName: 'created_at',
      propertyName: 'createdAt',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: true,
      hasDefault: false,
      isPrimaryKey: false,
      isUnique: false,
    },
  ];

  const result = coerceFormValues(formData, columns);

  // Output should use propertyName for Drizzle compatibility
  assertEquals(result.authorId, 42);
  assertEquals(result.createdAt, '2024-01-01');
  // And NOT have the snake_case keys
  assertEquals(result.author_id, undefined);
});

// =============================================================================
// getPagination tests
// =============================================================================

Deno.test('getPagination: default values', () => {
  const url = new URL('http://localhost/admin/users');
  const { page, limit, offset } = getPagination(url);

  assertEquals(page, 1);
  assertEquals(limit, 25);
  assertEquals(offset, 0);
});

Deno.test('getPagination: custom page', () => {
  const url = new URL('http://localhost/admin/users?page=3');
  const { page, offset } = getPagination(url);

  assertEquals(page, 3);
  assertEquals(offset, 50); // (3-1) * 25
});

Deno.test('getPagination: custom limit', () => {
  const url = new URL('http://localhost/admin/users?limit=10');
  const { limit, offset } = getPagination(url);

  assertEquals(limit, 10);
  assertEquals(offset, 0);
});

Deno.test('getPagination: enforces min page 1', () => {
  const url = new URL('http://localhost/admin/users?page=0');
  const { page } = getPagination(url);

  assertEquals(page, 1);
});

Deno.test('getPagination: enforces max limit 100', () => {
  const url = new URL('http://localhost/admin/users?limit=500');
  const { limit } = getPagination(url);

  assertEquals(limit, 100);
});

// =============================================================================
// getSort tests
// =============================================================================

Deno.test('getSort: returns null without sort param', () => {
  const url = new URL('http://localhost/admin/users');
  const columns = ['id', 'name', 'email'];

  assertEquals(getSort(url, columns), null);
});

Deno.test('getSort: ascending sort', () => {
  const url = new URL('http://localhost/admin/users?sort=name');
  const columns = ['id', 'name', 'email'];
  const sort = getSort(url, columns);

  assertExists(sort);
  assertEquals(sort.column, 'name');
  assertEquals(sort.direction, 'asc');
});

Deno.test('getSort: descending sort', () => {
  const url = new URL('http://localhost/admin/users?sort=-created_at');
  const columns = ['id', 'created_at'];
  const sort = getSort(url, columns);

  assertExists(sort);
  assertEquals(sort.column, 'created_at');
  assertEquals(sort.direction, 'desc');
});

Deno.test('getSort: returns null for invalid column', () => {
  const url = new URL('http://localhost/admin/users?sort=unknown');
  const columns = ['id', 'name'];

  assertEquals(getSort(url, columns), null);
});

// =============================================================================
// parseFormData tests
// =============================================================================

Deno.test('parseFormData: parses form data', async () => {
  const formData = new FormData();
  formData.append('name', 'John');
  formData.append('email', 'john@example.com');

  const request = new Request('http://localhost', {
    method: 'POST',
    body: formData,
  });

  const result = await parseFormData(request);

  assertEquals(result.name, 'John');
  assertEquals(result.email, 'john@example.com');
});

Deno.test('parseFormData: handles multiple values with same name', async () => {
  const formData = new FormData();
  formData.append('tag', 'one');
  formData.append('tag', 'two');

  const request = new Request('http://localhost', {
    method: 'POST',
    body: formData,
  });

  const result = await parseFormData(request);

  assertEquals(result.tag, ['one', 'two']);
});

// =============================================================================
// buildSecurityHeaders tests
// =============================================================================

Deno.test('buildSecurityHeaders: default CSP includes self and data for img-src', () => {
  const headers = buildSecurityHeaders();
  const csp = headers['Content-Security-Policy']!;

  assertEquals(csp.includes("img-src 'self' data:"), true);
  assertEquals(csp.includes("default-src 'self'"), true);
  assertEquals(csp.includes("frame-ancestors 'none'"), true);
});

Deno.test('buildSecurityHeaders: appends imgSrc origins', () => {
  const headers = buildSecurityHeaders({
    imgSrc: ['https://s3.example.com'],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(
    csp.includes("img-src 'self' data: https://s3.example.com"),
    true,
  );
});

Deno.test('buildSecurityHeaders: appends multiple imgSrc origins', () => {
  const headers = buildSecurityHeaders({
    imgSrc: ['https://s3.example.com', 'https://cdn.example.com'],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(
    csp.includes(
      "img-src 'self' data: https://s3.example.com https://cdn.example.com",
    ),
    true,
  );
});

Deno.test('buildSecurityHeaders: adds connect-src when connectSrc given', () => {
  const headers = buildSecurityHeaders({
    connectSrc: ['https://api.example.com'],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(
    csp.includes("connect-src 'self' https://api.example.com"),
    true,
  );
});

Deno.test('buildSecurityHeaders: adds frame-src when frameSrc given', () => {
  const headers = buildSecurityHeaders({
    frameSrc: ['https://embed.example.com'],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(
    csp.includes("frame-src 'self' https://embed.example.com"),
    true,
  );
});

Deno.test('buildSecurityHeaders: no connect-src/frame-src when not given', () => {
  const headers = buildSecurityHeaders();
  const csp = headers['Content-Security-Policy']!;

  assertEquals(csp.includes('connect-src'), false);
  assertEquals(csp.includes('frame-src'), false);
});

Deno.test('buildSecurityHeaders: preserves non-CSP headers', () => {
  const headers = buildSecurityHeaders({ imgSrc: ['https://s3.example.com'] });

  assertEquals(headers['X-Content-Type-Options'], 'nosniff');
  assertEquals(headers['X-Frame-Options'], 'DENY');
  assertEquals(
    headers['Referrer-Policy'],
    'strict-origin-when-cross-origin',
  );
});

Deno.test('buildSecurityHeaders: normalizes URLs to origins (strips paths)', () => {
  const headers = buildSecurityHeaders({
    connectSrc: ['https://s3.example.com/bucket/path'],
    imgSrc: ['http://localhost:9000/uploads/'],
  });
  const csp = headers['Content-Security-Policy']!;

  // Paths are stripped - only origins remain
  assertEquals(csp.includes('https://s3.example.com/bucket'), false);
  assertEquals(csp.includes("connect-src 'self' https://s3.example.com"), true);
  assertEquals(csp.includes('http://localhost:9000/uploads'), false);
  assertEquals(csp.includes('http://localhost:9000'), true);
});

Deno.test('htmlResponse: uses custom security headers when provided', () => {
  const custom = buildSecurityHeaders({
    imgSrc: ['https://s3.example.com'],
  });
  const response = htmlResponse('<p>Hi</p>', 200, custom);

  const csp = response.headers.get('Content-Security-Policy')!;
  assertEquals(csp.includes('https://s3.example.com'), true);
});

Deno.test('buildSecurityHeaders: adds styleSrc sources', () => {
  const headers = buildSecurityHeaders({
    styleSrc: ["'unsafe-inline'"],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(
    csp.includes("style-src 'self' 'unsafe-inline'"),
    true,
  );
});

Deno.test('buildSecurityHeaders: no extra style-src when styleSrc not given', () => {
  const headers = buildSecurityHeaders();
  const csp = headers['Content-Security-Policy']!;

  assertEquals(csp.includes("style-src 'self'"), true);
  assertEquals(csp.includes('unsafe-inline'), false);
});

Deno.test('buildSecurityHeaders: combines styleSrc with other directives', () => {
  const headers = buildSecurityHeaders({
    imgSrc: ['https://cdn.example.com'],
    styleSrc: ["'unsafe-inline'"],
  });
  const csp = headers['Content-Security-Policy']!;

  assertEquals(csp.includes("style-src 'self' 'unsafe-inline'"), true);
  assertEquals(csp.includes('https://cdn.example.com'), true);
});

// =============================================================================
// contentDispositionHeader tests
// =============================================================================

Deno.test('contentDispositionHeader: pure ASCII filename — single parameter', () => {
  assertEquals(
    contentDispositionHeader('inline', 'photo.png'),
    'inline; filename="photo.png"',
  );
  assertEquals(
    contentDispositionHeader('attachment', 'report.pdf'),
    'attachment; filename="report.pdf"',
  );
});

Deno.test('contentDispositionHeader: non-ASCII filename — dual parameters', () => {
  assertEquals(
    contentDispositionHeader('inline', 'naïve.png'),
    'inline; filename="na_ve.png"; filename*=UTF-8\'\'na%C3%AFve.png',
  );
  assertEquals(
    contentDispositionHeader('attachment', '写真.jpg'),
    'attachment; filename="__.jpg"; filename*=UTF-8\'\'%E5%86%99%E7%9C%9F.jpg',
  );
});

Deno.test('contentDispositionHeader: ASCII filename containing % — dual parameters', () => {
  // A stored filename that already contains a percent sign must not be
  // misread as a percent-encoded sequence by the browser.
  assertEquals(
    contentDispositionHeader('attachment', 'file%20name.png'),
    'attachment; filename="file%20name.png"; filename*=UTF-8\'\'file%2520name.png',
  );
});

Deno.test('contentDispositionHeader: filename with double-quote — fallback strips it', () => {
  assertEquals(
    contentDispositionHeader('attachment', 'say"hi".txt'),
    'attachment; filename="say_hi_.txt"; filename*=UTF-8\'\'say%22hi%22.txt',
  );
});

Deno.test('contentDispositionHeader: filename with backslash — fallback strips it', () => {
  assertEquals(
    contentDispositionHeader('attachment', 'path\\file.txt'),
    'attachment; filename="path_file.txt"; filename*=UTF-8\'\'path%5Cfile.txt',
  );
});

// =============================================================================
// readBodyWithLimit tests
// =============================================================================

/** Build a POST request whose body is a stream (no Content-Length header). */
function chunkedRequest(stream: ReadableStream<Uint8Array>): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    body: stream,
    // @ts-ignore: duplex is required for streaming request bodies
    duplex: 'half',
  });
}

Deno.test('readBodyWithLimit: body under the cap is returned', async () => {
  const req = new Request('http://localhost/', { method: 'POST', body: 'hi' });
  const result = await readBodyWithLimit(req, 10);
  assertEquals(result.tooLarge, false);
  assertEquals(result.body, 'hi');
});

Deno.test('readBodyWithLimit: body exactly at the cap passes', async () => {
  const req = new Request('http://localhost/', {
    method: 'POST',
    body: 'x'.repeat(10),
  });
  const result = await readBodyWithLimit(req, 10);
  assertEquals(result.tooLarge, false);
  assertEquals(result.body, 'x'.repeat(10));
});

Deno.test('readBodyWithLimit: Content-Length over the cap is rejected', async () => {
  const req = new Request('http://localhost/', {
    method: 'POST',
    body: 'x'.repeat(100),
    headers: { 'content-length': '100' },
  });
  const result = await readBodyWithLimit(req, 10);
  assertEquals(result.tooLarge, true);
  assertEquals(result.body, '');
});

Deno.test('readBodyWithLimit: chunked body over the cap is rejected', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('x'.repeat(100)));
      controller.close();
    },
  });
  const req = chunkedRequest(stream);
  assertEquals(req.headers.get('content-length'), null);
  const result = await readBodyWithLimit(req, 10);
  assertEquals(result.tooLarge, true);
  assertEquals(result.body, '');
});

Deno.test('readBodyWithLimit: aborts mid-stream before consuming the whole body', async () => {
  let pulledChunks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulledChunks++;
      // Each chunk is 8 bytes; the cap (10) is exceeded after the 2nd chunk.
      controller.enqueue(new TextEncoder().encode('xxxxxxxx'));
    },
    cancel() {
      cancelled = true;
    },
  });
  const result = await readBodyWithLimit(chunkedRequest(stream), 10);
  assertEquals(result.tooLarge, true);
  // The stream was cancelled rather than drained to completion.
  assertEquals(cancelled, true);
  // Only enough chunks to cross the cap were pulled (not an unbounded number).
  assertEquals(pulledChunks, 2);
});

Deno.test('readBodyWithLimit: absent body returns empty string', async () => {
  const req = new Request('http://localhost/', { method: 'GET' });
  const result = await readBodyWithLimit(req, 10);
  assertEquals(result.tooLarge, false);
  assertEquals(result.body, '');
});
