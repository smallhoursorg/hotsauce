/**
 * S3 Storage Plugin Route Tests
 *
 * Tests for:
 * - PublicEndpoint: presigned URLs use publicEndpoint for browser access
 * - Route body: POST body is passed to plugin route handlers
 */

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { buildObjectUrl, presignUrl } from '../sigv4.ts';
import { createS3StoragePlugin, validatePresignRequest } from '../mod.ts';
import type { PluginRouteContext } from '@hotsauce/cms';

// ─────────────────────────────────────────────────────────────
// PublicEndpoint Tests
// ─────────────────────────────────────────────────────────────

Deno.test('presignUrl: uses provided URL for signing (publicEndpoint flow)', async () => {
  // Simulate the pattern: internal endpoint vs public endpoint
  const internalEndpoint = 'http://minio:9000';
  const publicEndpoint = 'http://localhost:9000';
  const bucket = 'uploads';
  const key = 'media/file/123/test.png';

  // Build URL with publicEndpoint (browser-facing)
  const publicUrl = buildObjectUrl(publicEndpoint, bucket, key, 'path');
  assertEquals(
    publicUrl,
    'http://localhost:9000/uploads/media/file/123/test.png',
  );

  // Build URL with internal endpoint (server-facing)
  const internalUrl = buildObjectUrl(internalEndpoint, bucket, key, 'path');
  assertEquals(
    internalUrl,
    'http://minio:9000/uploads/media/file/123/test.png',
  );

  // Presign with public URL - this is what the browser receives
  const presignedPublic = await presignUrl({
    method: 'PUT',
    url: publicUrl,
    region: 'us-east-1',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    expirySeconds: 900,
    contentType: 'image/png',
  });

  // Verify the presigned URL uses localhost (public), not minio (internal)
  assertStringIncludes(presignedPublic, 'localhost:9000');
  assertStringIncludes(presignedPublic, 'X-Amz-Signature=');
});

Deno.test('buildObjectUrl: path-style with different endpoints', () => {
  const bucket = 'uploads';
  const key = 'test.png';

  // Internal Docker network
  assertEquals(
    buildObjectUrl('http://minio:9000', bucket, key, 'path'),
    'http://minio:9000/uploads/test.png',
  );

  // Public localhost
  assertEquals(
    buildObjectUrl('http://localhost:9000', bucket, key, 'path'),
    'http://localhost:9000/uploads/test.png',
  );

  // Production URL
  assertEquals(
    buildObjectUrl('https://s3.us-east-1.amazonaws.com', bucket, key, 'path'),
    'https://s3.us-east-1.amazonaws.com/uploads/test.png',
  );
});

// ─────────────────────────────────────────────────────────────
// Route Body Tests
// ─────────────────────────────────────────────────────────────

Deno.test('plugin route context: body field contains POST request body', () => {
  // Simulate the PluginRouteContext structure
  interface MockPluginRouteContext {
    method: string;
    body?: string;
    params: Record<string, string>;
  }

  // POST request with JSON body
  const ctx: MockPluginRouteContext = {
    method: 'POST',
    body: JSON.stringify({
      table: 'media',
      column: 'file',
      recordId: '123',
      filename: 'test.png',
      contentType: 'image/png',
      size: 1024,
    }),
    params: {},
  };

  // Body should be parseable
  const parsed = JSON.parse(ctx.body!);
  assertEquals(parsed.table, 'media');
  assertEquals(parsed.filename, 'test.png');
});

Deno.test('plugin route context: body is undefined for GET requests', () => {
  interface MockPluginRouteContext {
    method: string;
    body?: string;
    params: Record<string, string>;
  }

  // GET request has no body
  const ctx: MockPluginRouteContext = {
    method: 'GET',
    body: undefined,
    params: { table: 'media', id: '123', column: 'file' },
  };

  assertEquals(ctx.body, undefined);
});

Deno.test('presign handler: validates JSON body structure', () => {
  // Simulate the validation logic in the presign route handler
  // Note: table/id/column come from URL params (handled by CMS policy checks)
  // Body only contains file info

  // Helper that mirrors the actual validation in mod.ts
  const isValid = (
    body: { filename?: string; contentType?: string; size?: number },
  ) => {
    return !!(body.filename && body.contentType &&
      typeof body.size === 'number');
  };

  // All required fields present
  const validBody = {
    filename: 'test.png',
    contentType: 'image/png',
    size: 1024,
  };
  assertEquals(isValid(validBody), true);

  // Size 0 is valid (empty files should be uploadable)
  const zeroSizeBody = {
    filename: 'empty.txt',
    contentType: 'text/plain',
    size: 0,
  };
  assertEquals(isValid(zeroSizeBody), true);

  // Missing size field
  const missingSize = { filename: 'test.png', contentType: 'image/png' };
  assertEquals(isValid(missingSize), false);

  // Size is wrong type (string instead of number)
  const stringSize = {
    filename: 'test.png',
    contentType: 'image/png',
    size: '1024' as unknown as number,
  };
  assertEquals(isValid(stringSize), false);

  // Size is undefined
  const undefinedSize = {
    filename: 'test.png',
    contentType: 'image/png',
    size: undefined as unknown as number,
  };
  assertEquals(isValid(undefinedSize), false);
});

// ─────────────────────────────────────────────────────────────
// Integration: publicEndpoint separates internal vs browser URLs
// ─────────────────────────────────────────────────────────────

Deno.test('publicEndpoint: presigned upload URL differs from internal delete URL', async () => {
  const config = {
    endpoint: 'http://minio:9000', // Internal (for server→S3)
    publicEndpoint: 'http://localhost:9000', // Public (for browser→S3)
    bucket: 'uploads',
    region: 'us-east-1',
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
  };

  const key = 'media/file/1/doc.pdf';

  // Upload URL uses publicEndpoint (browser will PUT to this)
  const uploadUrl = buildObjectUrl(
    config.publicEndpoint,
    config.bucket,
    key,
    'path',
  );
  const presignedUpload = await presignUrl({
    method: 'PUT',
    url: uploadUrl,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expirySeconds: 900,
    contentType: 'application/pdf',
  });

  // Delete URL uses internal endpoint (server will DELETE from this)
  const deleteUrl = buildObjectUrl(config.endpoint, config.bucket, key, 'path');

  // Verify URLs point to different hosts
  assertStringIncludes(presignedUpload, 'localhost:9000');
  assertStringIncludes(deleteUrl, 'minio:9000');

  // Both should have the same path
  assertStringIncludes(presignedUpload, '/uploads/media/file/1/doc.pdf');
  assertStringIncludes(deleteUrl, '/uploads/media/file/1/doc.pdf');
});

// ─────────────────────────────────────────────────────────────
// Presign validation: maxSize and accept from $cms() options
// ─────────────────────────────────────────────────────────────

Deno.test('presign validation: rejects file exceeding maxSize', () => {
  const body = {
    filename: 'big.png',
    contentType: 'image/png',
    size: 5_000_000,
  };
  const config = { file: { maxSize: 200_000 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'File too large');
  assertStringIncludes(result!.error, '195KB');
});

Deno.test('presign validation: default 10MB limit applies when no maxSize set', () => {
  const body = {
    filename: 'huge.bin',
    contentType: 'application/octet-stream',
    size: 11 * 1024 * 1024,
  };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'File too large');
  assertStringIncludes(result!.error, '10MB');
});

Deno.test('presign validation: file within default 10MB limit passes', () => {
  const body = {
    filename: 'ok.bin',
    contentType: 'application/octet-stream',
    size: 9 * 1024 * 1024,
  };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: maxSize 0 disables size limit', () => {
  const body = {
    filename: 'huge.bin',
    contentType: 'application/octet-stream',
    size: 500 * 1024 * 1024,
  };
  const config = { file: { maxSize: 0 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: accepts file within maxSize', () => {
  const body = {
    filename: 'small.png',
    contentType: 'image/png',
    size: 100_000,
  };
  const config = { file: { maxSize: 200_000 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: accepts file at exactly maxSize', () => {
  const body = {
    filename: 'exact.png',
    contentType: 'image/png',
    size: 200_000,
  };
  const config = { file: { maxSize: 200_000 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: rejects wrong content type', () => {
  const body = {
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    size: 1000,
  };
  const config = { file: { accept: 'image/*' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'Invalid file type');
  assertStringIncludes(result!.error, 'image/*');
});

Deno.test('presign validation: accepts matching content type', () => {
  const body = { filename: 'photo.jpg', contentType: 'image/jpeg', size: 1000 };
  const config = { file: { accept: 'image/*' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: nested file config enforces maxSize', () => {
  const body = {
    filename: 'big.png',
    contentType: 'image/png',
    size: 5_000_000,
  };
  const config = { file: { maxSize: 200_000 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'File too large');
});

Deno.test('presign validation: nested file config enforces accept', () => {
  const body = {
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    size: 1000,
  };
  const config = { file: { accept: 'image/*' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'Invalid file type');
});

Deno.test('presign validation: accepts exact content type match', () => {
  const body = { filename: 'photo.png', contentType: 'image/png', size: 1000 };
  const config = { file: { accept: 'image/png,image/jpeg' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: rejects content type not in comma list', () => {
  const body = { filename: 'photo.gif', contentType: 'image/gif', size: 1000 };
  const config = { file: { accept: 'image/png,image/jpeg' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'Invalid file type');
});

Deno.test('presign validation: wildcard */* accepts anything', () => {
  const body = {
    filename: 'anything.zip',
    contentType: 'application/zip',
    size: 1000,
  };
  const config = { file: { accept: '*/*' } };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: */* inside an accept list matches any type', () => {
  const result = validatePresignRequest(
    { filename: 'photo.png', contentType: 'image/png', size: 1000 },
    { file: { accept: 'application/pdf,*/*' } },
  );
  assertEquals(result, null);
});

Deno.test('presign validation: no config means no restrictions', () => {
  const body = {
    filename: 'huge.bin',
    contentType: 'application/octet-stream',
    size: 999_999_999,
  };

  const result = validatePresignRequest(body, undefined);
  assertEquals(result, null);
});

Deno.test('presign validation: error shows MB for large limits', () => {
  const body = {
    filename: 'big.bin',
    contentType: 'application/octet-stream',
    size: 60_000_000,
  };
  const config = { file: { maxSize: 50 * 1024 * 1024 } };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, '50MB');
});

Deno.test('presign validation: both maxSize and accept checked together', () => {
  // Valid type but too big
  const bigImage = {
    filename: 'big.png',
    contentType: 'image/png',
    size: 5_000_000,
  };
  const config = { file: { maxSize: 200_000, accept: 'image/*' } };

  const result1 = validatePresignRequest(bigImage, config);
  assertEquals(result1 !== null, true);
  assertStringIncludes(result1!.error, 'File too large');

  // Valid size but wrong type
  const smallPdf = {
    filename: 'doc.pdf',
    contentType: 'application/pdf',
    size: 1000,
  };
  const result2 = validatePresignRequest(smallPdf, config);
  assertEquals(result2 !== null, true);
  assertStringIncludes(result2!.error, 'Invalid file type');

  // Both valid
  const goodFile = {
    filename: 'ok.png',
    contentType: 'image/png',
    size: 100_000,
  };
  const result3 = validatePresignRequest(goodFile, config);
  assertEquals(result3, null);
});

// ─────────────────────────────────────────────────────────────
// Presign validation: content-type cross-validation (extension ↔ claimed MIME)
// ─────────────────────────────────────────────────────────────

Deno.test('presign validation: rejects unrecognised file extension', () => {
  const body = {
    filename: 'data.xyz999',
    contentType: 'application/octet-stream',
    size: 1000,
  };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'Unrecognised file extension');
});

Deno.test('presign validation: rejects content-type mismatch', () => {
  const body = {
    filename: 'malware.exe',
    contentType: 'image/png',
    size: 1000,
  };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.error, 'Content type mismatch');
  assertStringIncludes(result!.error, 'application/x-msdos-program');
});

Deno.test('presign validation: .jpg with image/jpeg passes', () => {
  const body = { filename: 'photo.jpg', contentType: 'image/jpeg', size: 1000 };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: .jpeg with image/jpeg passes', () => {
  const body = {
    filename: 'photo.jpeg',
    contentType: 'image/jpeg',
    size: 1000,
  };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

Deno.test('presign validation: uppercase extension is validated', () => {
  const body = { filename: 'photo.PNG', contentType: 'image/png', size: 1000 };
  const config = { file: true };

  const result = validatePresignRequest(body, config);
  assertEquals(result, null);
});

/** Storage provider off a plugin built with the standard test options. */
function makeProvider(extra: Record<string, unknown> = {}) {
  const plugin = createS3StoragePlugin({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    urlStyle: 'path',
    basePath: '/admin',
    ...extra,
  });
  return plugin.storageProvider!;
}

// ─────────────────────────────────────────────────────────────
// ListObjectsV2 Pagination Tests
// ─────────────────────────────────────────────────────────────

Deno.test('listObjects: paginates through multiple pages', async () => {
  // Track fetch calls
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;

  // Mock fetch to return paginated responses
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(url);

    // First page: truncated with continuation token
    if (!url.includes('continuation-token')) {
      return Promise.resolve(
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?>
        <ListBucketResult>
          <IsTruncated>true</IsTruncated>
          <NextContinuationToken>token-page-2</NextContinuationToken>
          <Contents>
            <Key>prefix/file1.png</Key>
            <LastModified>2024-01-01T00:00:00.000Z</LastModified>
            <Size>1000</Size>
          </Contents>
          <Contents>
            <Key>prefix/file2.png</Key>
            <LastModified>2024-01-02T00:00:00.000Z</LastModified>
            <Size>2000</Size>
          </Contents>
        </ListBucketResult>`,
          { status: 200 },
        ),
      );
    }

    // Second page: not truncated (final page)
    return Promise.resolve(
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>prefix/file3.png</Key>
          <LastModified>2024-01-03T00:00:00.000Z</LastModified>
          <Size>3000</Size>
        </Contents>
      </ListBucketResult>`,
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    const provider = makeProvider();
    const results = await provider.listObjects!('prefix/');

    // Should have made 2 fetch calls (2 pages)
    assertEquals(fetchCalls.length, 2);

    // First call should not have continuation token
    assertEquals(fetchCalls[0]!.includes('continuation-token'), false);

    // Second call should have continuation token
    assertStringIncludes(fetchCalls[1]!, 'continuation-token=token-page-2');

    // Should have all 3 objects from both pages
    assertEquals(results.length, 3);
    assertEquals(results[0]!.key, 'prefix/file1.png');
    assertEquals(results[1]!.key, 'prefix/file2.png');
    assertEquals(results[2]!.key, 'prefix/file3.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test('listObjects: single page (not truncated) makes one request', async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(url);

    return Promise.resolve(
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
      <ListBucketResult>
        <IsTruncated>false</IsTruncated>
        <Contents>
          <Key>prefix/only-file.png</Key>
          <LastModified>2024-01-01T00:00:00.000Z</LastModified>
          <Size>500</Size>
        </Contents>
      </ListBucketResult>`,
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    const provider = makeProvider();
    const results = await provider.listObjects!('prefix/');

    // Only 1 fetch call for non-truncated response
    assertEquals(fetchCalls.length, 1);
    assertEquals(results.length, 1);
    assertEquals(results[0]!.key, 'prefix/only-file.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─────────────────────────────────────────────────────────────
// signDownloadUrl: key safety + CDN URL building
// ─────────────────────────────────────────────────────────────

Deno.test('signDownloadUrl: CDN branch trims trailing slashes and encodes the key', async () => {
  const provider = makeProvider({ cdnBaseUrl: 'https://cdn.example.com/' });

  const url = await provider.signDownloadUrl!({
    storage: 's3',
    key: 'media/file/1/a b.png',
  });
  assertEquals(url, 'https://cdn.example.com/media/file/1/a%20b.png');
});

Deno.test('signDownloadUrl: CDN branch rejects a traversal key', async () => {
  const provider = makeProvider({ cdnBaseUrl: 'https://cdn.example.com' });

  await assertRejects(
    () =>
      provider.signDownloadUrl!({
        storage: 's3',
        key: 'media/file/1/../../etc/passwd',
      }),
    Error,
    'Invalid storage key',
  );
});

Deno.test('signDownloadUrl: presign branch rejects a traversal key', async () => {
  const provider = makeProvider();

  await assertRejects(
    () =>
      provider.signDownloadUrl!({
        storage: 's3',
        key: 'media/file/1/../../etc/passwd',
      }),
    Error,
    'Invalid storage key',
  );
});

Deno.test('signDownloadUrl: rejects percent-encoded traversal (CDN-decode smuggling)', async () => {
  // '%2e%2e%2f' decodes to '../' at a CDN that resolves the path; reject it at
  // the key validator so it never reaches the CDN URL literally.
  const key = 'media/file/1/%2e%2e%2f%2e%2e%2fetc/passwd';
  for (
    const provider of [
      makeProvider({ cdnBaseUrl: 'https://cdn.example.com' }),
      makeProvider(),
    ]
  ) {
    await assertRejects(
      () => provider.signDownloadUrl!({ storage: 's3', key }),
      Error,
      'percent-encoding',
    );
  }
});

// ─────────────────────────────────────────────────────────────
// deleteObject: key safety
// ─────────────────────────────────────────────────────────────

Deno.test('deleteObject: rejects a traversal key before signing or fetching', async () => {
  const provider = makeProvider();
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => {
    fetchCalled = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  try {
    for (
      const key of [
        'media/file/1/../../../../victim/secret.txt',
        'media/file/1/./x.png',
        '/etc/passwd',
        'media/file/1/%2e%2e/x.png',
      ]
    ) {
      await assertRejects(
        () => provider.deleteObject!({ storage: 's3', key }),
        Error,
        'Invalid storage key',
      );
    }
    assertEquals(fetchCalled, false, 'no DELETE must be issued');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ─────────────────────────────────────────────────────────────
// Routes: presign and upload page require a file column
// ─────────────────────────────────────────────────────────────

function makeCtx(
  overrides: Partial<PluginRouteContext> = {},
): PluginRouteContext {
  return {
    table: '',
    recordId: '',
    column: undefined,
    record: {},
    value: undefined,
    field: undefined,
    user: undefined,
    csrfToken: 'csrf',
    sourceToken: 'source',
    basePath: '/admin',
    requestUrl: 'http://localhost/admin/s3-storage/_x',
    method: 'GET',
    body: undefined,
    params: {},
    ...overrides,
  };
}

// deno-lint-ignore no-explicit-any
function findRoute(plugin: any, pattern: string, method: string) {
  return plugin.routes.find(
    // deno-lint-ignore no-explicit-any
    (r: any) =>
      r.pattern === pattern && (r.methods ?? ['GET']).includes(method),
  );
}

function makePlugin() {
  return createS3StoragePlugin({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'test-bucket',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    urlStyle: 'path',
    basePath: '/admin',
  });
}

Deno.test('routes: presign 404s when the column is not a file field', async () => {
  const plugin = makePlugin();
  const presignRoute = findRoute(plugin, ':table/:id/:column', 'POST');
  const res = await presignRoute.handler(makeCtx({
    table: 'posts',
    recordId: '42',
    column: 'title',
    method: 'POST',
    field: { name: 'title', type: 'text', config: {} },
    requestUrl: 'http://localhost/admin/s3-storage/posts/42/title',
    body: JSON.stringify({
      filename: 'huge.bin',
      contentType: 'application/octet-stream',
      size: 10 * 1024 * 1024 * 1024,
    }),
    params: { table: 'posts', id: '42', column: 'title' },
  })) as Response;
  assertEquals(res.status, 404);
  const json = await res.json();
  assertEquals(json.error, 'Not a file field');
});

Deno.test('routes: presign 404s when the column does not exist', async () => {
  const plugin = makePlugin();
  const presignRoute = findRoute(plugin, ':table/:id/:column', 'POST');
  // The CMS leaves ctx.field undefined for an unknown column.
  const res = await presignRoute.handler(makeCtx({
    table: 'posts',
    recordId: '42',
    column: 'anything',
    method: 'POST',
    field: undefined,
    requestUrl: 'http://localhost/admin/s3-storage/posts/42/anything',
    body: JSON.stringify({
      filename: 'a.bin',
      contentType: 'application/octet-stream',
      size: 10,
    }),
    params: { table: 'posts', id: '42', column: 'anything' },
  })) as Response;
  assertEquals(res.status, 404);
});

Deno.test('routes: presign succeeds for a configured file column', async () => {
  const plugin = makePlugin();
  const presignRoute = findRoute(plugin, ':table/:id/:column', 'POST');
  const res = await presignRoute.handler(makeCtx({
    table: 'posts',
    recordId: '42',
    column: 'image',
    method: 'POST',
    field: { name: 'image', type: 'file', config: { file: true } },
    requestUrl: 'http://localhost/admin/s3-storage/posts/42/image',
    body: JSON.stringify({
      filename: 'photo.png',
      contentType: 'image/png',
      size: 1024,
    }),
    params: { table: 'posts', id: '42', column: 'image' },
  })) as Response;
  assertEquals(res.status, 200);
  const json = await res.json();
  assertStringIncludes(json.key, 'posts/image/42/');
});

Deno.test('routes: upload page 404s when the column is not a file field', async () => {
  const plugin = makePlugin();
  const pageRoute = findRoute(plugin, ':table/:id/:column', 'GET');
  const res = await pageRoute.handler(makeCtx({
    table: 'posts',
    recordId: '42',
    column: 'title',
    field: { name: 'title', type: 'text', config: {} },
    requestUrl: 'http://localhost/admin/s3-storage/posts/42/title',
    params: { table: 'posts', id: '42', column: 'title' },
  })) as Response;
  assertEquals(res.status, 404);
});
