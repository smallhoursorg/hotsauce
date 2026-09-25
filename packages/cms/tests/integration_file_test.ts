// File Upload Integration Tests
// Tests file upload, serving, and clearing with real database

import { assertEquals, assertStringIncludes } from '@std/assert';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  AUTH_SECRET,
  createProfilesTable,
  generateSourceToken,
  pluginSource,
  profiles,
  schemaWithFiles,
  SOURCE,
  TEST_CSRF_SECRET,
  TEST_PDF_HEADER,
  TEST_PNG_1X1_RED,
} from './integration_helpers.ts';
import { createCmsHandler, createJwtPayload, signJwt } from '../mod.ts';
import { generateCsrfToken } from '../csrf.ts';
import type { AuthProvider } from '@hotsauce/auth';

/** Minimal no-op AuthProvider — just enables JWT auth without needing a users table */
const noopAuthProvider: AuthProvider = {
  authenticate() {
    return Promise.resolve(null);
  },
};

Deno.test('integration: file upload tests', async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema: schemaWithFiles });

  await createProfilesTable(db);

  async function resetDb() {
    await db.execute(sql`TRUNCATE TABLE profiles RESTART IDENTITY CASCADE`);
  }

  function createHandler() {
    return createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
    });
  }

  await t.step(
    'create form has multipart encoding for file fields',
    async () => {
      const handler = createHandler();
      const request = new Request('http://localhost/admin/profiles/new');
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'enctype="multipart/form-data"');
      assertStringIncludes(html, 'type="file"');
    },
  );

  await t.step('edit form has multipart encoding for file fields', async () => {
    await resetDb();
    await db.insert(profiles).values({ name: 'Test Profile' });

    const handler = createHandler();
    const request = new Request('http://localhost/admin/profiles/1/edit');
    const response = await handler(request);

    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'enctype="multipart/form-data"');
  });

  await t.step('uploads file and stores as FileReference', async () => {
    await resetDb();

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Profile with Avatar');
    formData.append(
      'avatar',
      new Blob([TEST_PNG_1X1_RED], { type: 'image/png' }),
      'avatar.png',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    assertEquals(response.status, 303);

    // Verify the profile was created with file data
    const [profile] = await db.select().from(profiles);
    assertEquals(profile?.name, 'Profile with Avatar');

    // Check avatar is a valid FileReference
    const avatar = profile?.avatar as {
      filename: string;
      contentType: string;
      size: number;
      data: string;
    } | null;
    assertEquals(avatar?.filename, 'avatar.png');
    assertEquals(avatar?.contentType, 'image/png');
    assertEquals(avatar?.size, TEST_PNG_1X1_RED.length);
    assertEquals(typeof avatar?.data, 'string'); // base64
  });

  await t.step('serves uploaded file', async () => {
    await resetDb();

    // Create profile with avatar
    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Profile for Download',
      avatar: {
        filename: 'test.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Content-Type'), 'image/png');
    assertEquals(
      response.headers.get('Content-Disposition'),
      'inline; filename="test.png"',
    );

    const body = await response.arrayBuffer();
    assertEquals(body.byteLength, TEST_PNG_1X1_RED.length);
  });

  await t.step(
    'Content-Disposition uses RFC 6266 encoding for non-ASCII filenames',
    async () => {
      await resetDb();

      const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
      await db.insert(profiles).values({
        name: 'Profile with Unicode Filename',
        avatar: {
          filename: 'naïve.png',
          contentType: 'image/png',
          size: TEST_PNG_1X1_RED.length,
          data: base64Data,
        },
      });

      const handler = createHandler();
      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get('Content-Disposition'),
        'inline; filename="na_ve.png"; filename*=UTF-8\'\'na%C3%AFve.png',
      );
    },
  );

  await t.step('detail view shows image preview for image files', async () => {
    await resetDb();

    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Profile with Image',
      avatar: {
        filename: 'photo.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const request = new Request('http://localhost/admin/profiles/1');
    const response = await handler(request);

    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'photo.png');
    assertStringIncludes(html, 'cms-file-preview'); // Preview img class
  });

  await t.step('clears file when delete button clicked', async () => {
    await resetDb();

    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Profile to Clear',
      avatar: {
        filename: 'to-delete.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Submit with _clear_avatar=1
    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Profile to Clear');
    formData.append('_clear_avatar', '1');

    const request = new Request('http://localhost/admin/profiles/1', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    assertEquals(response.status, 303);

    // Verify avatar was cleared
    const [profile] = await db.select().from(profiles);
    assertEquals(profile?.avatar, null);
  });

  await t.step(
    'ignores _clear_ for a file column the user cannot write',
    async () => {
      await resetDb();

      const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
      const original = {
        filename: 'keep-me.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      };
      await db.insert(profiles).values({
        name: 'Read-only avatar',
        avatar: original,
      });

      // avatar is readable but not writable for this user
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: {
          profiles: {
            columns: {
              avatar: { write: () => false },
            },
          },
        },
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
      });
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Read-only avatar (renamed)');
      formData.append('_clear_avatar', '1');

      const response = await handler(
        new Request('http://localhost/admin/profiles/1', {
          method: 'POST',
          body: formData,
        }),
      );
      assertEquals(response.status, 303);

      const [profile] = await db.select().from(profiles);
      assertEquals(profile?.name, 'Read-only avatar (renamed)');
      assertEquals(profile?.avatar, original, 'avatar must not be cleared');
    },
  );

  await t.step('rejects file exceeding maxSize', async () => {
    await resetDb();

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Document field has maxSize of 1MB, create a larger file
    const largeContent = new Uint8Array(1024 * 1024 + 1); // 1MB + 1 byte

    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Profile with Large Doc');
    formData.append(
      'document',
      new Blob([largeContent], { type: 'application/pdf' }),
      'large.pdf',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    // Should show form with error, not redirect
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'File too large');
  });

  await t.step('rejects file with wrong content type', async () => {
    await resetDb();

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Document field accepts only PDF
    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Profile with Wrong Type');
    formData.append(
      'document',
      new Blob([TEST_PNG_1X1_RED], { type: 'image/png' }),
      'image.png',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    // Should show form with error
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'Invalid file type');
  });

  await t.step('accepts file with valid content type', async () => {
    await resetDb();

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Profile with PDF');
    formData.append(
      'document',
      new Blob([TEST_PDF_HEADER], { type: 'application/pdf' }),
      'doc.pdf',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    assertEquals(response.status, 303);

    const [profile] = await db.select().from(profiles);
    const doc = profile?.document as { filename: string } | null;
    assertEquals(doc?.filename, 'doc.pdf');
  });

  await t.step('returns 404 for non-existent file', async () => {
    await resetDb();

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/999',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  await t.step('returns 404 for file route with no data', async () => {
    await resetDb();

    // Create profile without avatar
    await db.insert(profiles).values({ name: 'No Avatar' });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  // ──────────────────────────────────────────────────────────
  // URL redirect tests (file serving when FileReference.url exists)
  // ──────────────────────────────────────────────────────────

  await t.step('redirects to url when FileReference has url', async () => {
    await resetDb();

    await db.insert(profiles).values({
      name: 'Profile with URL',
      avatar: {
        filename: 'remote.png',
        contentType: 'image/png',
        size: 1024,
        url: 'https://cdn.example.com/images/remote.png',
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get('Location'),
      'https://cdn.example.com/images/remote.png',
    );
    // The endpoint's own cache header must win over the no-store default
    // that rides along in the spread security headers.
    assertEquals(
      response.headers.get('Cache-Control'),
      'private, max-age=3600',
    );
  });

  await t.step(
    'returns 404 for unsafe url protocol (javascript:)',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'Malicious URL',
        avatar: {
          filename: 'evil.png',
          contentType: 'image/png',
          size: 100,
          url: 'javascript:alert(1)',
        },
      });

      const handler = createHandler();
      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
      );
      const response = await handler(request);

      // Must be 404 (not 403) to avoid leaking file existence
      assertEquals(response.status, 404);
    },
  );

  await t.step('returns 404 for unsafe url protocol (ftp:)', async () => {
    await resetDb();

    await db.insert(profiles).values({
      name: 'FTP URL',
      avatar: {
        filename: 'file.png',
        contentType: 'image/png',
        size: 100,
        url: 'ftp://evil.example.com/file.png',
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  await t.step('returns 404 for malformed url', async () => {
    await resetDb();

    await db.insert(profiles).values({
      name: 'Bad URL',
      avatar: {
        filename: 'broken.png',
        contentType: 'image/png',
        size: 100,
        url: 'not-a-valid-url',
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  // ──────────────────────────────────────────────────────────
  // File replacement on update
  // ──────────────────────────────────────────────────────────

  await t.step('replaces existing file with new upload', async () => {
    await resetDb();

    // Create profile with initial avatar
    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Replace Test',
      avatar: {
        filename: 'old.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Upload a new avatar (PDF pretending to be image for size difference)
    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Replace Test');
    formData.append(
      'avatar',
      new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/png' }),
      'new-avatar.png',
    );

    const request = new Request('http://localhost/admin/profiles/1', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    assertEquals(response.status, 303);

    // Verify file was replaced
    const [profile] = await db.select().from(profiles);
    const avatar = profile?.avatar as {
      filename: string;
      contentType: string;
      size: number;
      data: string;
    } | null;
    assertEquals(avatar?.filename, 'new-avatar.png');
    assertEquals(avatar?.size, 5);
  });

  // ──────────────────────────────────────────────────────────
  // CSRF rejection
  // ──────────────────────────────────────────────────────────

  await t.step('rejects file upload without CSRF token', async () => {
    await resetDb();

    const handler = createHandler();

    const formData = new FormData();
    // Deliberately omit __cms_csrf and __cms_source
    formData.append('name', 'Should Fail');
    formData.append(
      'avatar',
      new Blob([TEST_PNG_1X1_RED], { type: 'image/png' }),
      'test.png',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    // CSRF failure re-renders form with error message (not 303 redirect)
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'Invalid or expired form');

    // Verify no profile was created
    const allProfiles = await db.select().from(profiles);
    assertEquals(allProfiles.length, 0);
  });

  await t.step('rejects file upload with invalid CSRF token', async () => {
    await resetDb();

    const handler = createHandler();

    const formData = new FormData();
    formData.append('__cms_csrf', 'completely-invalid-token');
    formData.append('__cms_source', 'also-invalid');
    formData.append('name', 'Should Fail');
    formData.append(
      'avatar',
      new Blob([TEST_PNG_1X1_RED], { type: 'image/png' }),
      'test.png',
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    // CSRF failure re-renders form with error message (not 303 redirect)
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'Invalid or expired form');

    // Verify no profile was created
    const allProfiles = await db.select().from(profiles);
    assertEquals(allProfiles.length, 0);
  });

  // ──────────────────────────────────────────────────────────
  // Additional file serving edge cases
  // ──────────────────────────────────────────────────────────

  await t.step('returns 404 for non-file column', async () => {
    await resetDb();

    await db.insert(profiles).values({ name: 'Test' });

    const handler = createHandler();
    // 'name' is not a file column
    const request = new Request(
      'http://localhost/admin/files/profiles/name/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  await t.step('returns 404 for non-existent table in file route', async () => {
    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/nonexistent/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 404);
  });

  await t.step(
    'returns 404 for non-existent column in file route',
    async () => {
      await resetDb();

      await db.insert(profiles).values({ name: 'Test' });

      const handler = createHandler();
      const request = new Request(
        'http://localhost/admin/files/profiles/nonexistent/1',
      );
      const response = await handler(request);

      assertEquals(response.status, 404);
    },
  );

  await t.step('serves SVG as attachment (not inline)', async () => {
    await resetDb();

    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const base64Data = btoa(svgContent);
    await db.insert(profiles).values({
      name: 'SVG Test',
      avatar: {
        filename: 'icon.svg',
        contentType: 'image/svg+xml',
        size: svgContent.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    const disposition = response.headers.get('Content-Disposition');
    assertStringIncludes(disposition ?? '', 'attachment');
  });

  await t.step('sets strict CSP on served files', async () => {
    await resetDb();

    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'CSP Test',
      avatar: {
        filename: 'test.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    const csp = response.headers.get('Content-Security-Policy');
    assertStringIncludes(csp ?? '', "script-src 'none'");
    assertStringIncludes(csp ?? '', 'sandbox');
  });

  await t.step('sets Cache-Control on served files', async () => {
    await resetDb();

    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Cache Test',
      avatar: {
        filename: 'test.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });

    const handler = createHandler();
    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    const cacheControl = response.headers.get('Cache-Control');
    assertStringIncludes(cacheControl ?? '', 'private');
  });

  await t.step(
    'returns 404 for FileReference with no data or url',
    async () => {
      await resetDb();

      // Insert a FileReference that has neither data nor url
      await db.insert(profiles).values({
        name: 'No Data Test',
        avatar: {
          filename: 'ghost.png',
          contentType: 'image/png',
          size: 1024,
          // no data, no url — just metadata
        },
      });

      const handler = createHandler();
      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
      );
      const response = await handler(request);

      assertEquals(response.status, 404);
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // 4-segment /admin/files/<table>/<col>/<id>/<filename> path
  //
  // The trailing filename segment is accepted and intentionally ignored —
  // it exists solely for SEO-friendly URLs. The file is always resolved
  // by table+column+id; the name on the segment has no effect.
  // ──────────────────────────────────────────────────────────────────────

  await t.step(
    '4-segment URL with correct filename serves the same file as 3-segment URL',
    async () => {
      await resetDb();

      const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
      await db.insert(profiles).values({
        name: 'Profile for SEO URL',
        avatar: {
          filename: 'portrait.png',
          contentType: 'image/png',
          size: TEST_PNG_1X1_RED.length,
          data: base64Data,
        },
      });

      const handler = createHandler();

      const res3 = await handler(
        new Request('http://localhost/admin/files/profiles/avatar/1'),
      );
      const res4 = await handler(
        new Request(
          'http://localhost/admin/files/profiles/avatar/1/portrait.png',
        ),
      );

      assertEquals(res3.status, 200);
      assertEquals(res4.status, 200);
      assertEquals(
        res4.headers.get('Content-Type'),
        res3.headers.get('Content-Type'),
      );
      const body3 = new Uint8Array(await res3.arrayBuffer());
      const body4 = new Uint8Array(await res4.arrayBuffer());
      assertEquals(body4, body3);
    },
  );

  await t.step(
    '4-segment URL with wrong filename still serves the file (filename is ignored)',
    async () => {
      await resetDb();

      const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
      await db.insert(profiles).values({
        name: 'Profile for SEO URL',
        avatar: {
          filename: 'portrait.png',
          contentType: 'image/png',
          size: TEST_PNG_1X1_RED.length,
          data: base64Data,
        },
      });

      const handler = createHandler();
      const response = await handler(
        new Request(
          'http://localhost/admin/files/profiles/avatar/1/completely-wrong-name.jpg',
        ),
      );

      // The segment is ignored; the file is served regardless.
      assertEquals(response.status, 200);
      assertEquals(response.headers.get('Content-Type'), 'image/png');
    },
  );

  await t.step(
    '5-segment URL is rejected (too many path segments → falls through to 404)',
    async () => {
      await resetDb();

      const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
      await db.insert(profiles).values({
        name: 'Profile',
        avatar: {
          filename: 'portrait.png',
          contentType: 'image/png',
          size: TEST_PNG_1X1_RED.length,
          data: base64Data,
        },
      });

      const handler = createHandler();
      const response = await handler(
        new Request(
          'http://localhost/admin/files/profiles/avatar/1/portrait.png/extra',
        ),
      );

      // parts.length === 5 fails the <= 4 guard → falls through to 404
      assertEquals(response.status, 404);
    },
  );

  await client.close();
});

// ============================================================================
// Policy-gated file serving tests
// ============================================================================

Deno.test('integration: policy-gated file serving', async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema: schemaWithFiles });

  await createProfilesTable(db);

  async function resetDb() {
    await db.execute(sql`TRUNCATE TABLE profiles RESTART IDENTITY CASCADE`);
  }

  // Insert a profile with a file for all sub-tests
  async function seedProfile() {
    await resetDb();
    const base64Data = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));
    await db.insert(profiles).values({
      name: 'Policy Test',
      avatar: {
        filename: 'secret.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: base64Data,
      },
    });
  }

  await t.step('row policy denial returns 404 (not 403)', async () => {
    await seedProfile();

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
      auth: {
        secret: AUTH_SECRET,
        provider: noopAuthProvider,
      },
      policies: {
        // Deny all reads on profiles
        profiles: { read: () => false as const },
      },
    });

    const payload = createJwtPayload('1');
    const token = await signJwt(payload, AUTH_SECRET);

    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
      { headers: { Cookie: `cms_token=${token}` } },
    );
    const response = await handler(request);

    // Must be 404, not 403 — avoid leaking that the record exists
    assertEquals(response.status, 404);
  });

  await t.step('column policy denial returns 404 (not 403)', async () => {
    await seedProfile();

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
      auth: {
        secret: AUTH_SECRET,
        provider: noopAuthProvider,
      },
      policies: {
        profiles: {
          columns: {
            // Hide avatar column from all users
            avatar: { read: () => false },
          },
        },
      },
    });

    const payload = createJwtPayload('1');
    const token = await signJwt(payload, AUTH_SECRET);

    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
      { headers: { Cookie: `cms_token=${token}` } },
    );
    const response = await handler(request);

    // Must be 404, not 403 — avoid leaking that the column has data
    assertEquals(response.status, 404);
  });

  await t.step('allowed policy serves file normally', async () => {
    await seedProfile();

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
      auth: {
        secret: AUTH_SECRET,
        provider: noopAuthProvider,
      },
      policies: {
        // Allow all reads
        profiles: { read: () => undefined },
      },
    });

    const payload = createJwtPayload('1');
    const token = await signJwt(payload, AUTH_SECRET);

    const request = new Request(
      'http://localhost/admin/files/profiles/avatar/1',
      { headers: { Cookie: `cms_token=${token}` } },
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Content-Type'), 'image/png');
  });

  // ──────────────────────────────────────────────────────────────────────
  // __cms_source token plumbing on /admin/files/...
  //
  // /admin/files/... must propagate ?__cms_source=<token> into the policy
  // context so that source-aware row policies behave consistently with
  // the picker list page (handleList). Without this, a policy that allows
  // reads inside the picker iframe would still 404 every thumbnail and
  // every editor-canvas image, even though the user just selected the row.
  // ──────────────────────────────────────────────────────────────────────

  function makeSourceGatedHandler() {
    return createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
      auth: {
        secret: AUTH_SECRET,
        provider: noopAuthProvider,
      },
      policies: {
        // Only allow reads when ctx.source identifies the puck plugin.
        profiles: (ctx) =>
          ctx.source === pluginSource('puck') ? undefined : false,
      },
    });
  }

  await t.step(
    'source-gated row policy: file 404s when __cms_source missing',
    async () => {
      await seedProfile();

      const handler = makeSourceGatedHandler();
      const payload = createJwtPayload('1');
      const token = await signJwt(payload, AUTH_SECRET);

      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
        { headers: { Cookie: `cms_token=${token}` } },
      );
      const response = await handler(request);

      // Policy returns false because ctx.source is undefined → 404
      assertEquals(response.status, 404);
    },
  );

  await t.step(
    'source-gated row policy: file serves when valid __cms_source matches',
    async () => {
      await seedProfile();

      const handler = makeSourceGatedHandler();
      const payload = createJwtPayload('1');
      const token = await signJwt(payload, AUTH_SECRET);
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/files/profiles/avatar/1?__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
        { headers: { Cookie: `cms_token=${token}` } },
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      assertEquals(response.headers.get('Content-Type'), 'image/png');
    },
  );

  await t.step(
    'source-gated row policy: file 404s when __cms_source is for a different plugin',
    async () => {
      await seedProfile();

      const handler = makeSourceGatedHandler();
      const payload = createJwtPayload('1');
      const token = await signJwt(payload, AUTH_SECRET);
      const wrongSourceToken = await generateSourceToken(
        pluginSource('other-plugin'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/files/profiles/avatar/1?__cms_source=${
          encodeURIComponent(wrongSourceToken)
        }`,
        { headers: { Cookie: `cms_token=${token}` } },
      );
      const response = await handler(request);

      // Token validates, but ctx.source !== 'plugin:puck' → policy denies → 404
      assertEquals(response.status, 404);
    },
  );

  await t.step(
    'invalid __cms_source token is treated as missing (no 4xx escalation, policy decides)',
    async () => {
      await seedProfile();

      // Permissive policy that doesn't care about source
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        auth: {
          secret: AUTH_SECRET,
          provider: noopAuthProvider,
        },
        policies: 'dangerously-open',
      });

      const payload = createJwtPayload('1');
      const token = await signJwt(payload, AUTH_SECRET);

      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1?__cms_source=garbage.not.a.token',
        { headers: { Cookie: `cms_token=${token}` } },
      );
      const response = await handler(request);

      // Bad token silently falls back to ctx.source = undefined.
      // Permissive policy still allows the read.
      assertEquals(response.status, 200);
      assertEquals(response.headers.get('Content-Type'), 'image/png');
    },
  );

  await t.step(
    'expired __cms_source token is treated as missing',
    async () => {
      await seedProfile();

      const handler = makeSourceGatedHandler();
      const payload = createJwtPayload('1');
      const token = await signJwt(payload, AUTH_SECRET);

      // Hand-craft a token whose timestamp is well past the 4h TTL.
      // Token format: source.timestamp(base36).signature
      // Signature won't match for an arbitrary timestamp, so this exercises
      // the "invalid signature → null source" branch. Either way the
      // observable behavior is the same as a missing token: policy denies.
      const expiredToken = `${pluginSource('puck')}.${
        (Date.now() - 5 * 60 * 60 * 1000).toString(36)
      }.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;

      const request = new Request(
        `http://localhost/admin/files/profiles/avatar/1?__cms_source=${
          encodeURIComponent(expiredToken)
        }`,
        { headers: { Cookie: `cms_token=${token}` } },
      );
      const response = await handler(request);

      // Source token rejected → ctx.source = undefined → policy denies → 404
      assertEquals(response.status, 404);
    },
  );

  await client.close();
});

// ============================================================================
// File key tampering prevention tests (Finding 2)
// ============================================================================

Deno.test('integration: file key tampering prevention', async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema: schemaWithFiles });

  await createProfilesTable(db);

  async function resetDb() {
    await db.execute(sql`TRUNCATE TABLE profiles RESTART IDENTITY CASCADE`);
  }

  function createHandler() {
    return createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
    });
  }

  function createHandlerWithStorage() {
    return createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithFiles,
      basePath: '/admin',
      plugins: [
        {
          name: 'mock-s3',
          storageProvider: {
            id: 's3',
            kind: 's3' as const,
            presignUpload: () =>
              Promise.resolve({
                key: '',
                upload: { method: 'PUT' as const, url: '' },
              }),
          },
        },
      ],
      storage: 's3',
    });
  }

  await t.step('create rejects file ref with storage key', async () => {
    await resetDb();

    const handler = createHandler();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Attempt to submit a file reference with a storage key during CREATE
    // This should be rejected - presign requires existing record ID
    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Tampered Create');
    formData.append(
      'avatar',
      JSON.stringify({
        filename: 'tampered.png',
        contentType: 'image/png',
        size: 1234,
        key: 'profiles/avatar/999/fake-key.png',
        storage: 's3',
      }),
    );

    const request = new Request('http://localhost/admin/profiles/new', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    // Should render form with error, not redirect
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(
      html,
      'Storage-backed files cannot be attached during create',
    );
  });

  await t.step(
    'create rejects file ref with storage key (JSON API)',
    async () => {
      await resetDb();

      const handler = createHandler();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Tampered Create JSON');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'tampered.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/999/fake-key.png',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/new', {
        method: 'POST',
        body: formData,
        headers: { Accept: 'application/json' },
      });
      const response = await handler(request);

      assertEquals(response.status, 400);
      const json = await response.json();
      assertEquals(json.success, false);
      assertEquals(json.action, 'create');
      assertStringIncludes(
        json.errors.avatar[0],
        'Storage-backed files cannot be attached',
      );
    },
  );

  await t.step(
    'update rejects file ref with wrong record ID in key',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Original Profile' });

      const handler = createHandlerWithStorage();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Attempt to submit a key that belongs to record ID 999 when editing record ID 1
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Tampered Update');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'stolen.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/999/stolen-file.png', // Wrong record ID!
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'Invalid file reference');
    },
  );

  await t.step('update rejects file ref with wrong table in key', async () => {
    await resetDb();
    await db.insert(profiles).values({ name: 'Target Profile' });

    const handler = createHandlerWithStorage();
    const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
    const sourceToken = await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET);

    // Key from a different table
    const formData = new FormData();
    formData.append('__cms_csrf', csrfToken);
    formData.append('__cms_source', sourceToken);
    formData.append('name', 'Cross-Table Attack');
    formData.append(
      'avatar',
      JSON.stringify({
        filename: 'cross-table.png',
        contentType: 'image/png',
        size: 1234,
        key: 'other_table/avatar/1/cross-table.png', // Wrong table!
        storage: 's3',
      }),
    );

    const request = new Request('http://localhost/admin/profiles/1', {
      method: 'POST',
      body: formData,
    });
    const response = await handler(request);

    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'Invalid file reference');
  });

  await t.step(
    'update rejects file ref with wrong storage provider',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Storage Mismatch' });

      const handler = createHandlerWithStorage();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Valid key prefix but wrong storage provider
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Storage Tampering');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'valid-key.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/valid-uuid-prefix.png', // Valid key for record 1
          storage: 'malicious-provider', // Non-existent provider
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'Invalid storage provider');
    },
  );

  await t.step(
    'update normalizes missing storage field when storage is configured',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Missing Storage' });

      const handler = createHandlerWithStorage();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Valid key prefix but storage field omitted — should be normalized
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Storage Field Missing');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'sneaky.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/valid-uuid-prefix.png', // Valid key for record 1
          // storage field intentionally omitted — should be filled from config
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Should succeed (303 redirect) — storage normalized to 'test-s3'
      assertEquals(response.status, 303);
    },
  );

  await t.step(
    'update accepts valid file ref with correct key prefix',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Valid Update' });

      const handler = createHandlerWithStorage();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Valid key with correct prefix for record 1
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Valid Update');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'legitimate.png',
          contentType: 'image/png',
          size: 5678,
          key: 'profiles/avatar/1/abc123-legitimate.png', // Correct prefix!
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Should succeed with redirect
      assertEquals(response.status, 303);

      // Verify the file reference was saved
      const [profile] = await db.select().from(profiles);
      const avatar = profile?.avatar as
        | { key?: string; storage?: string }
        | null;
      assertEquals(avatar?.key, 'profiles/avatar/1/abc123-legitimate.png');
      assertEquals(avatar?.storage, 's3');
    },
  );

  await t.step(
    'update accepts valid storage when resolveStorage routes to non-default',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Resolver Test' });

      // Create handler with resolveStorage that routes avatar column to 'archive'
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
            },
          },
          {
            name: 'mock-archive',
            storageProvider: {
              id: 'archive',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
            },
          },
        ],
        // Route avatar column to 'archive', everything else to s3
        storage: (ctx) => ctx.column === 'avatar' ? 'archive' : 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Submit with 'archive' storage (matches resolver for avatar column)
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Resolver Test');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'resolved.png',
          contentType: 'image/png',
          size: 9999,
          key: 'profiles/avatar/1/resolved-key.png',
          storage: 'archive', // Matches resolveStorage result, not default!
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Should succeed - 'archive' matches resolver output for this column
      assertEquals(response.status, 303);

      const [profile] = await db.select().from(profiles);
      const avatar = profile?.avatar as
        | { key?: string; storage?: string }
        | null;
      assertEquals(avatar?.storage, 'archive');
    },
  );

  await t.step(
    'update rejects storage mismatch when resolveStorage routes elsewhere',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Resolver Mismatch' });

      // Same resolver: avatar -> 'archive'
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
            },
          },
          {
            name: 'mock-archive',
            storageProvider: {
              id: 'archive',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
            },
          },
        ],
        storage: (ctx) => ctx.column === 'avatar' ? 'archive' : 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Try to submit with 's3' but resolver routes avatar to 'archive'
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Resolver Mismatch');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'wrong-storage.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/wrong-storage.png',
          storage: 's3', // Doesn't match resolver (should be 'archive')
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Should fail - 's3' doesn't match resolver's 'archive' for avatar
      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'Invalid storage provider');
    },
  );

  await t.step(
    'update rejects key when no storage provider expected (DB-routed column)',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'DB Only' });

      // Handler without storage — all file columns use inline DB storage
      const handler = createHandler();
      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'DB Only');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'sneaky.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/injected-key.png', // Key should not exist without storage
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'does not use external storage');
    },
  );

  await t.step(
    'update rejects when resolveStorage returns unregistered provider',
    async () => {
      await resetDb();
      await db.insert(profiles).values({ name: 'Bad Config' });

      // resolver returns 'nonexistent' which is not in instances
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
            },
          },
        ],
        // Resolver returns an ID that no plugin registered
        storage: () => 'nonexistent',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Bad Config');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'test.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/test-key.png',
          storage: 'nonexistent',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'is not registered');
    },
  );

  // ─────────────────────────────────────────────────────────────
  // Storage cleanup on record delete tests
  // ─────────────────────────────────────────────────────────────

  await t.step(
    'delete cleans up storage objects for file columns',
    async () => {
      await resetDb();

      // Track deleteObject calls
      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
            },
          },
        ],
        storage: 's3',
      });

      // Insert record with storage-backed file reference
      await db.insert(profiles).values({
        name: 'Profile with S3 file',
        avatar: {
          filename: 'avatar.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/uuid-avatar.png',
          storage: 's3',
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);

      const request = new Request('http://localhost/admin/profiles/1/delete', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);
      assertStringIncludes(
        response.headers.get('Location') ?? '',
        '_flash=delete_success',
      );

      // Verify storage object was deleted
      assertEquals(deletedKeys.length, 1);
      assertEquals(deletedKeys[0], 'profiles/avatar/1/uuid-avatar.png');

      // Verify DB record is gone
      const remaining = await db.select().from(profiles);
      assertEquals(remaining.length, 0);
    },
  );

  await t.step(
    'delete cleanup is fail-soft (storage error does not fail delete)',
    async () => {
      await resetDb();

      let errorLogged = false;

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: () => {
                throw new Error('S3 delete failed');
              },
            },
          },
        ],
        storage: 's3',
        onError: () => {
          errorLogged = true;
        },
      });

      // Insert record with storage-backed file
      await db.insert(profiles).values({
        name: 'Profile with failing cleanup',
        avatar: {
          filename: 'avatar.png',
          contentType: 'image/png',
          size: 1234,
          key: 'profiles/avatar/1/uuid-avatar.png',
          storage: 's3',
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);

      const request = new Request('http://localhost/admin/profiles/1/delete', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Delete should succeed even though storage cleanup failed
      assertEquals(response.status, 303);
      assertStringIncludes(
        response.headers.get('Location') ?? '',
        '_flash=delete_success',
      );

      // Error should have been logged
      assertEquals(errorLogged, true);

      // DB record should be gone
      const remaining = await db.select().from(profiles);
      assertEquals(remaining.length, 0);
    },
  );

  await t.step(
    'delete does not cleanup storage for DB-inline files (no key)',
    async () => {
      await resetDb();

      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
            },
          },
        ],
        storage: 's3',
      });

      // Insert record with DB-inline file (has data, no key)
      await db.insert(profiles).values({
        name: 'Profile with inline file',
        avatar: {
          filename: 'avatar.png',
          contentType: 'image/png',
          size: 100,
          data: 'base64encodeddata',
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);

      const request = new Request('http://localhost/admin/profiles/1/delete', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);
      assertStringIncludes(
        response.headers.get('Location') ?? '',
        '_flash=delete_success',
      );

      // No storage cleanup for inline files
      assertEquals(deletedKeys.length, 0);
    },
  );

  await t.step(
    'update without file in form data does not delete S3 object',
    async () => {
      await resetDb();

      // Record has an existing S3 file
      await db.insert(profiles).values({
        name: 'Keep my file',
        avatar: {
          filename: 'photo.png',
          contentType: 'image/png',
          size: 5000,
          key: 'profiles/avatar/1/keep-uuid-photo.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Submit form with only name changed — no file field at all
      // This simulates the S3 edit form where file input is replaced by plugin UI
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Updated name only');

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);

      // File should NOT be deleted — it wasn't in the form submission
      assertEquals(deletedKeys.length, 0);

      // DB record should still have the file
      const [profile] = await db.select().from(profiles);
      const avatar = profile?.avatar as { key?: string } | null;
      assertEquals(avatar?.key, 'profiles/avatar/1/keep-uuid-photo.png');
    },
  );

  // ─────────────────────────────────────────────────────────────
  // Orphan cleanup on save tests
  // ─────────────────────────────────────────────────────────────

  await t.step(
    'update cleans up orphan files under same prefix',
    async () => {
      await resetDb();

      // Simulate a record with an existing S3 file
      await db.insert(profiles).values({
        name: 'Profile with orphans',
        avatar: {
          filename: 'current.png',
          contentType: 'image/png',
          size: 1000,
          key: 'profiles/avatar/1/current-uuid-current.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];
      const listedPrefixes: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
              listObjects: (prefix) => {
                listedPrefixes.push(prefix);
                return Promise.resolve([
                  // The old key (already known — deleteOldFileObjects handles this)
                  {
                    key: 'profiles/avatar/1/current-uuid-current.png',
                    lastModified: new Date('2025-01-01'),
                    size: 1000,
                  },
                  // An orphan from an abandoned upload
                  {
                    key: 'profiles/avatar/1/orphan-uuid-abandoned.png',
                    lastModified: new Date('2025-01-01'),
                    size: 2000,
                  },
                  // The new file being saved
                  {
                    key: 'profiles/avatar/1/new-uuid-photo.png',
                    lastModified: new Date(),
                    size: 3000,
                  },
                ]);
              },
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Update the file field with a new S3 key
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Profile with orphans');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'photo.png',
          contentType: 'image/png',
          size: 3000,
          key: 'profiles/avatar/1/new-uuid-photo.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);

      // Should have listed the prefix for orphan detection
      assertEquals(listedPrefixes.length, 1);
      assertEquals(listedPrefixes[0], 'profiles/avatar/1/');

      // Should have deleted the old key AND the orphan, but NOT the new key
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/current-uuid-current.png'),
        true,
      );
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/orphan-uuid-abandoned.png'),
        true,
      );
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/new-uuid-photo.png'),
        false,
      );
    },
  );

  await t.step(
    'update with same file does not trigger orphan cleanup',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'No change',
        avatar: {
          filename: 'same.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/same-uuid-same.png',
          storage: 's3',
        },
      });

      const listedPrefixes: string[] = [];
      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
              listObjects: (prefix) => {
                listedPrefixes.push(prefix);
                return Promise.resolve([]);
              },
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      // Submit with the same file reference (no change)
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'No change');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'same.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/same-uuid-same.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);

      // No listing or deletions when file hasn't changed
      assertEquals(listedPrefixes.length, 0);
      assertEquals(deletedKeys.length, 0);
    },
  );

  await t.step(
    'orphan cleanup is fail-soft (listObjects error does not fail update)',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'Error test',
        avatar: {
          filename: 'old.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/old-uuid.png',
          storage: 's3',
        },
      });

      let errorLogged = false;

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: () => Promise.resolve(),
              listObjects: () => {
                throw new Error('S3 ListObjects exploded');
              },
            },
          },
        ],
        storage: 's3',
        onError: () => {
          errorLogged = true;
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Error test');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'new.png',
          contentType: 'image/png',
          size: 600,
          key: 'profiles/avatar/1/new-uuid.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Update should still succeed despite listObjects failure
      assertEquals(response.status, 303);

      // Error should have been logged
      assertEquals(errorLogged, true);

      // DB should have the new file
      const [profile] = await db.select().from(profiles);
      const avatar = profile?.avatar as { key?: string } | null;
      assertEquals(avatar?.key, 'profiles/avatar/1/new-uuid.png');
    },
  );

  await t.step(
    'orphan cleanup skips providers without listObjects',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'No listObjects',
        avatar: {
          filename: 'old.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/old-uuid.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
              // No listObjects — orphan cleanup should be skipped
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'No listObjects');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'new.png',
          contentType: 'image/png',
          size: 600,
          key: 'profiles/avatar/1/new-uuid.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);

      // Only the old key should be deleted (eager delete), no orphan scan
      assertEquals(deletedKeys.length, 1);
      assertEquals(deletedKeys[0], 'profiles/avatar/1/old-uuid.png');
    },
  );

  await t.step(
    'orphan cleanup skips providers without deleteObject',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'No deleteObject',
        avatar: {
          filename: 'old.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/old-uuid.png',
          storage: 's3',
        },
      });

      let errorLogged = false;

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              listObjects: () => {
                return Promise.resolve([
                  {
                    key: 'profiles/avatar/1/old-orphan.png',
                    lastModified: new Date('2025-01-01'),
                    size: 1000,
                  },
                  {
                    key: 'profiles/avatar/1/new-uuid.png',
                    lastModified: new Date(),
                    size: 3000,
                  },
                ]);
              },
              // No deleteObject — orphan cleanup (and eager delete) should be skipped
            },
          },
        ],
        storage: 's3',
        onError: () => {
          errorLogged = true;
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'No deleteObject');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'new.png',
          contentType: 'image/png',
          size: 600,
          key: 'profiles/avatar/1/new-uuid.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Update should succeed; orphan cleanup should be a no-op without deleteObject
      assertEquals(response.status, 303);
      assertEquals(errorLogged, false);

      const [profile] = await db.select().from(profiles);
      const avatar = profile?.avatar as { key?: string } | null;
      assertEquals(avatar?.key, 'profiles/avatar/1/new-uuid.png');
    },
  );

  await t.step(
    'orphan cleanup skips recently uploaded files (grace period)',
    async () => {
      await resetDb();

      await db.insert(profiles).values({
        name: 'Grace period test',
        avatar: {
          filename: 'old.png',
          contentType: 'image/png',
          size: 500,
          key: 'profiles/avatar/1/old-uuid.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
              listObjects: () => {
                return Promise.resolve([
                  // Old orphan — should be deleted
                  {
                    key: 'profiles/avatar/1/old-orphan.png',
                    lastModified: new Date('2025-01-01'),
                    size: 1000,
                  },
                  // Recent upload — should be kept (within grace period)
                  {
                    key: 'profiles/avatar/1/recent-concurrent.png',
                    lastModified: new Date(), // just now
                    size: 2000,
                  },
                  // The new key being saved
                  {
                    key: 'profiles/avatar/1/new-uuid.png',
                    lastModified: new Date(),
                    size: 3000,
                  },
                ]);
              },
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const sourceToken = await generateSourceToken(
        SOURCE.CMS,
        TEST_CSRF_SECRET,
      );

      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);
      formData.append('__cms_source', sourceToken);
      formData.append('name', 'Grace period test');
      formData.append(
        'avatar',
        JSON.stringify({
          filename: 'new.png',
          contentType: 'image/png',
          size: 3000,
          key: 'profiles/avatar/1/new-uuid.png',
          storage: 's3',
        }),
      );

      const request = new Request('http://localhost/admin/profiles/1', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      assertEquals(response.status, 303);

      // Old key (from deleteOldFileObjects) and old orphan should be deleted
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/old-uuid.png'),
        true,
      );
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/old-orphan.png'),
        true,
      );

      // Recent concurrent upload should NOT be deleted (grace period)
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/recent-concurrent.png'),
        false,
      );

      // New key should NOT be deleted
      assertEquals(
        deletedKeys.includes('profiles/avatar/1/new-uuid.png'),
        false,
      );
    },
  );

  // ──────────────────────────────────────────────────────────
  // Defense-in-depth: key validation in file serving and deletion
  // ──────────────────────────────────────────────────────────

  await t.step(
    'file serving returns 404 for tampered key (wrong prefix)',
    async () => {
      await resetDb();

      // Simulate DB tampering: insert a record with a key that
      // doesn't match the expected {table}/{column}/{recordId}/ prefix
      await db.insert(profiles).values({
        name: 'Tampered Record',
        avatar: {
          filename: 'tampered.png',
          contentType: 'image/png',
          size: 1000,
          key: 'other-table/other-column/999/secret-file.png', // Wrong prefix
          storage: 's3',
        },
      });

      let signCalled = false;
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              signDownloadUrl: () => {
                signCalled = true;
                return Promise.resolve('https://s3.example.com/signed');
              },
            },
          },
        ],
        storage: 's3',
      });

      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
      );
      const response = await handler(request);

      // Should return 404, not sign the tampered key
      assertEquals(response.status, 404);
      assertEquals(signCalled, false);
    },
  );

  await t.step(
    'file serving accepts valid key (correct prefix)',
    async () => {
      await resetDb();

      // Valid key with correct prefix
      await db.insert(profiles).values({
        name: 'Valid Record',
        avatar: {
          filename: 'valid.png',
          contentType: 'image/png',
          size: 1000,
          key: 'profiles/avatar/1/valid-uuid.png', // Correct prefix
          storage: 's3',
        },
      });

      let signedKey: string | null = null;
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              signDownloadUrl: (ctx) => {
                signedKey = ctx.key;
                return Promise.resolve('https://s3.example.com/signed');
              },
            },
          },
        ],
        storage: 's3',
      });

      const request = new Request(
        'http://localhost/admin/files/profiles/avatar/1',
      );
      const response = await handler(request);

      // Should redirect to signed URL
      assertEquals(response.status, 302);
      assertEquals(signedKey, 'profiles/avatar/1/valid-uuid.png');
      // Cache the redirect (not the signed URL itself) so browsers avoid
      // a DB + signing round-trip on every grid/picker render.
      assertEquals(
        response.headers.get('Cache-Control'),
        'private, max-age=60, must-revalidate',
        'storage 302 redirect must carry Cache-Control to allow browser caching',
      );
    },
  );

  await t.step(
    'delete skips invalid key and calls onError (defense-in-depth)',
    async () => {
      await resetDb();

      // Simulate DB tampering: record has a key with wrong prefix
      await db.insert(profiles).values({
        name: 'Tampered for Delete',
        avatar: {
          filename: 'tampered.png',
          contentType: 'image/png',
          size: 1000,
          key: 'other-table/other-column/999/should-not-delete.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];
      const errors: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
            },
          },
        ],
        storage: 's3',
        onError: (err) => {
          errors.push(err.message);
        },
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);

      const request = new Request('http://localhost/admin/profiles/1/delete', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Delete should succeed (DB record removed)
      assertEquals(response.status, 303);

      // But the tampered key should NOT be deleted from storage
      assertEquals(deletedKeys.length, 0);

      // onError should be called with the validation failure
      assertEquals(errors.length > 0, true);
      assertStringIncludes(errors[0] ?? '', 'Skipping deletion of invalid key');
    },
  );

  await t.step(
    'delete removes valid key (correct prefix)',
    async () => {
      await resetDb();

      // Valid key with correct prefix
      await db.insert(profiles).values({
        name: 'Valid for Delete',
        avatar: {
          filename: 'valid.png',
          contentType: 'image/png',
          size: 1000,
          key: 'profiles/avatar/1/valid-uuid.png',
          storage: 's3',
        },
      });

      const deletedKeys: string[] = [];

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithFiles,
        basePath: '/admin',
        plugins: [
          {
            name: 'mock-s3',
            storageProvider: {
              id: 's3',
              kind: 's3' as const,
              presignUpload: () =>
                Promise.resolve({
                  key: '',
                  upload: { method: 'PUT' as const, url: '' },
                }),
              deleteObject: (ctx) => {
                deletedKeys.push(ctx.key);
                return Promise.resolve();
              },
            },
          },
        ],
        storage: 's3',
      });

      const csrfToken = await generateCsrfToken(TEST_CSRF_SECRET);
      const formData = new FormData();
      formData.append('__cms_csrf', csrfToken);

      const request = new Request('http://localhost/admin/profiles/1/delete', {
        method: 'POST',
        body: formData,
      });
      const response = await handler(request);

      // Delete should succeed
      assertEquals(response.status, 303);

      // Valid key should be deleted
      assertEquals(deletedKeys.length, 1);
      assertEquals(deletedKeys[0], 'profiles/avatar/1/valid-uuid.png');
    },
  );

  await client.close();
});
