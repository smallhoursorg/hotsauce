// Picker Mode Integration Tests
// Tests that picker mode only returns PK + explicitly opted-in source columns (secure by default)

import { assertEquals, assertStringIncludes } from '@std/assert';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  json,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  generateSourceToken,
  pluginSource,
  SOURCE,
  TEST_CSRF_SECRET,
} from './integration_helpers.ts';
import { createCmsHandler } from '../mod.ts';

// Import extend module for side effects (patches Drizzle prototypes)
import '@hotsauce/core/extend';

// ============================================================================
// Test Schemas
// ============================================================================

// Standard schema with id + file (common case)
// File column must explicitly opt in with plugins.puck.role = 'source'
const media = pgTable('media', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  file: json('file').$cms({
    file: { accept: 'image/*' },
    thumbnail: true,
    plugins: { puck: { role: 'source' } },
  }),
  secretNotes: text('secret_notes'), // Should NOT appear in picker
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const schemaWithMedia = { media };

// Custom schema with different PK name (uuid) and file column name (image)
const photos = pgTable('photos', {
  photoId: serial('photo_id').primaryKey(), // Not 'id'
  name: varchar('name', { length: 200 }).notNull(),
  image: json('image').$cms({
    file: { accept: 'image/*' },
    thumbnail: true,
    plugins: { puck: { role: 'source' } },
  }),
  internalCode: text('internal_code'), // Should NOT appear in picker
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const schemaWithPhotos = { photos };

// Schema with source columns (columns opted into plugin data)
const assets = pgTable('assets', {
  id: serial('id').primaryKey(),
  file: json('file').$cms({
    file: { accept: 'image/*' },
    thumbnail: true,
    plugins: { puck: { role: 'source' } },
  }),
  // Alt text opts into puck plugin as source data - SHOULD appear in picker
  alt: text('alt').$cms({ plugins: { puck: { role: 'source' } } }),
  // Caption has no plugin config - should NOT appear in picker
  caption: text('caption'),
  // Internal notes - should NOT appear in picker
  internalNotes: text('internal_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const schemaWithAssets = { assets };

// Schema with thumbnail but NO plugin config (file should NOT be in picker)
const gallery = pgTable('gallery', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  // File has thumbnail: true (for grid display) but NO plugins config
  // This should NOT appear in picker data - thumbnail is for rendering only
  image: json('image').$cms({
    file: { accept: 'image/*' },
    thumbnail: true,
    // Intentionally no plugins config
  }),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

const schemaWithGallery = { gallery };

// ============================================================================
// Tests
// ============================================================================

Deno.test('integration: picker mode tests', async (t) => {
  await t.step(
    'picker mode returns only PK + source columns (standard schema)',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      // Create table
      await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      // Insert test data
      await db.insert(media).values([
        {
          title: 'Photo One',
          file: {
            filename: 'photo1.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
          secretNotes: 'TOP SECRET: do not leak this',
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      // Generate plugin source token (required for picker mode)
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      // Should be in picker mode
      assertStringIncludes(html, 'cms-grid-picker-item');

      // Should include id and file in data-picker-record (HTML-escaped quotes)
      assertStringIncludes(html, '&quot;id&quot;:1');
      assertStringIncludes(html, '&quot;filename&quot;:&quot;photo1.jpg&quot;');

      // Should NOT include other columns
      assertEquals(
        html.includes('TOP SECRET'),
        false,
        'secretNotes should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;title&quot;'),
        false,
        'title should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;secretNotes&quot;'),
        false,
        'secretNotes key should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;createdAt&quot;'),
        false,
        'createdAt should not appear in picker data',
      );
    },
  );

  await t.step('picker mode rejects CMS source tokens', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema: schemaWithMedia });

    // Create table
    await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.insert(media).values([
      {
        title: 'Photo One',
        file: {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
          size: 1024,
        },
      },
    ]);

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithMedia,
      basePath: '/admin',
    });

    const cmsSourceToken = await generateSourceToken(
      SOURCE.CMS,
      TEST_CSRF_SECRET,
    );

    const request = new Request(
      `http://localhost/admin/media?picker=true&__cms_source=${
        encodeURIComponent(cmsSourceToken)
      }`,
    );
    const response = await handler(request);

    assertEquals(response.status, 403);
    const body = await response.text();
    assertStringIncludes(body, 'plugin source token');
  });

  await t.step(
    'picker mode returns only PK + source columns (custom column names)',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithPhotos });

      // Create table with different column names
      await db.execute(sql`
      CREATE TABLE photos (
        photo_id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        image JSON,
        internal_code TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      // Insert test data
      await db.insert(photos).values([
        {
          name: 'Sunset',
          image: {
            filename: 'sunset.jpg',
            contentType: 'image/jpeg',
            size: 2048,
          },
          internalCode: 'INTERNAL-12345',
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithPhotos,
        basePath: '/admin',
      });

      // Generate plugin source token
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/photos?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      // Should be in picker mode
      assertStringIncludes(html, 'cms-grid-picker-item');

      // Server-authoritative column name must be present so the field can
      // persist the correct column without the caller knowing the schema.
      assertStringIncludes(html, 'data-picker-column="image"');

      // Should include photoId and image in data-picker-record (HTML-escaped quotes)
      assertStringIncludes(html, '&quot;photoId&quot;:1');
      assertStringIncludes(html, 'data-picker-pk="photoId"');
      assertStringIncludes(html, '&quot;filename&quot;:&quot;sunset.jpg&quot;');

      // Should NOT include other columns
      assertEquals(
        html.includes('INTERNAL-12345'),
        false,
        'internalCode should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;name&quot;'),
        false,
        'name should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;internalCode&quot;'),
        false,
        'internalCode key should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;createdAt&quot;'),
        false,
        'createdAt should not appear in picker data',
      );
    },
  );

  await t.step(
    'picker mode includes source columns for the requesting plugin',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithAssets });

      // Create table
      await db.execute(sql`
      CREATE TABLE assets (
        id SERIAL PRIMARY KEY,
        file JSON,
        alt TEXT,
        caption TEXT,
        internal_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      // Insert test data
      await db.insert(assets).values([
        {
          file: { filename: 'hero.jpg', contentType: 'image/jpeg', size: 4096 },
          alt: 'A beautiful sunrise over mountains',
          caption: 'Photo by Jane Smith',
          internalNotes: 'CONFIDENTIAL: Client requested this image',
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithAssets,
        basePath: '/admin',
      });

      // Generate plugin source token for 'puck'
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/assets?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      // Should be in picker mode
      assertStringIncludes(html, 'cms-grid-picker-item');

      // Should include id, file, AND alt (source column for puck)
      assertStringIncludes(html, '&quot;id&quot;:1');
      assertStringIncludes(html, '&quot;filename&quot;:&quot;hero.jpg&quot;');
      assertStringIncludes(
        html,
        '&quot;alt&quot;:&quot;A beautiful sunrise over mountains&quot;',
      );

      // Should NOT include caption (no plugin config)
      assertEquals(
        html.includes('Photo by Jane Smith'),
        false,
        'caption value should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;caption&quot;'),
        false,
        'caption key should not appear in picker data',
      );

      // Should NOT include internalNotes
      assertEquals(
        html.includes('CONFIDENTIAL'),
        false,
        'internalNotes value should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;internalNotes&quot;'),
        false,
        'internalNotes key should not appear in picker data',
      );
    },
  );

  await t.step('picker source columns are plugin-isolated', async () => {
    // Source columns should only be included for the plugin that declared them
    // Alt is declared for 'puck', so 'tinymce' plugin should NOT see it
    const client = new PGlite();
    const db = drizzle(client, { schema: schemaWithAssets });

    await db.execute(sql`
      CREATE TABLE assets (
        id SERIAL PRIMARY KEY,
        file JSON,
        alt TEXT,
        caption TEXT,
        internal_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.insert(assets).values([
      {
        file: { filename: 'hero.jpg', contentType: 'image/jpeg', size: 4096 },
        alt: 'A beautiful sunrise over mountains',
        caption: 'Photo by Jane Smith',
        internalNotes: 'CONFIDENTIAL',
      },
    ]);

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithAssets,
      basePath: '/admin',
    });

    // Generate source token for 'tinymce' plugin (NOT puck)
    const sourceToken = await generateSourceToken(
      pluginSource('tinymce'),
      TEST_CSRF_SECRET,
    );

    const request = new Request(
      `http://localhost/admin/assets?picker=true&__cms_source=${
        encodeURIComponent(sourceToken)
      }`,
    );
    const response = await handler(request);

    assertEquals(response.status, 200);
    const html = await response.text();

    // Should include only id (PK always included)
    assertStringIncludes(html, '&quot;id&quot;:1');

    // Should NOT include file column in picker record data
    // (file is opted into puck, not tinymce)
    // Note: filename still appears in label/alt, but not in data-picker-record JSON
    assertEquals(
      html.includes('&quot;file&quot;:'),
      false,
      'file key should not appear in picker record for tinymce plugin',
    );

    // Should NOT include alt (alt is opted into puck, not tinymce)
    assertEquals(
      html.includes('beautiful sunrise'),
      false,
      'alt value should not appear for tinymce plugin',
    );
    assertEquals(
      html.includes('&quot;alt&quot;'),
      false,
      'alt key should not appear for tinymce plugin',
    );
  });

  await t.step(
    'thumbnail: true without plugins config excludes file from picker',
    async () => {
      // File columns with thumbnail: true but no plugins config should NOT be in picker data
      // thumbnail: true is for grid rendering, not plugin data exposure
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithGallery });

      await db.execute(sql`
      CREATE TABLE gallery (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        image JSON,
        description TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      await db.insert(gallery).values([
        {
          title: 'Beach Photo',
          image: {
            filename: 'beach.jpg',
            contentType: 'image/jpeg',
            size: 8192,
          },
          description: 'A sunny day at the beach',
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithGallery,
        basePath: '/admin',
      });

      // Generate source token for puck plugin
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/gallery?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      // Should be in picker mode
      assertStringIncludes(html, 'cms-grid-picker-item');

      // Should include only id (PK always included)
      assertStringIncludes(html, '&quot;id&quot;:1');

      // Should NOT include image column in picker record data
      // (image has thumbnail: true but no plugins.puck config)
      assertEquals(
        html.includes('&quot;image&quot;:'),
        false,
        'image key should not appear in picker data (no plugins config)',
      );
      assertEquals(
        html.includes('&quot;filename&quot;:'),
        false,
        'filename should not appear in picker data',
      );

      // Should NOT include title or description
      assertEquals(
        html.includes('&quot;title&quot;'),
        false,
        'title should not appear in picker data',
      );
      assertEquals(
        html.includes('&quot;description&quot;'),
        false,
        'description should not appear in picker data',
      );
    },
  );

  await t.step(
    'column hidden by column policy is absent from picker data',
    async () => {
      // 'alt' opts into puck as a source column, but a column policy hides it.
      // Column read policy takes precedence over plugin opt-in — policy wins.
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithAssets });

      await db.execute(sql`
        CREATE TABLE assets (
          id SERIAL PRIMARY KEY,
          file JSON,
          alt TEXT,
          caption TEXT,
          internal_notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await db.insert(assets).values([
        {
          file: { filename: 'hero.jpg', contentType: 'image/jpeg', size: 4096 },
          alt: 'Hidden alt text that should never appear',
          caption: 'Public caption',
          internalNotes: 'CONFIDENTIAL',
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: {
          assets: {
            columns: {
              // 'alt' is a puck source column but hidden by column read policy
              alt: { read: () => false },
            },
          },
        },
        db,
        schema: schemaWithAssets,
        basePath: '/admin',
      });

      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/assets?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      assertStringIncludes(html, 'cms-grid-picker-item');
      // PK always present
      assertStringIncludes(html, '&quot;id&quot;:1');
      // 'file' is a puck source column and not hidden — must appear
      assertStringIncludes(html, '&quot;filename&quot;:&quot;hero.jpg&quot;');
      // 'alt' is a puck source column but hidden by column policy — must be absent
      assertEquals(
        html.includes('Hidden alt text'),
        false,
        'alt value must not appear in picker data when hidden by column policy',
      );
      assertEquals(
        html.includes('&quot;alt&quot;'),
        false,
        'alt key must not appear in picker data when hidden by column policy',
      );
    },
  );

  await t.step('picker mode requires valid source token', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema: schemaWithMedia });

    await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithMedia,
      basePath: '/admin',
    });

    // Request picker mode WITHOUT source token
    const request = new Request('http://localhost/admin/media?picker=true');
    const response = await handler(request);

    // Should be rejected
    assertEquals(response.status, 403);
    const html = await response.text();
    assertStringIncludes(html, 'Forbidden');
  });

  await t.step('picker mode rejects invalid source token', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema: schemaWithMedia });

    await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    const handler = createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema: schemaWithMedia,
      basePath: '/admin',
    });

    // Request picker mode with invalid source token
    const request = new Request(
      'http://localhost/admin/media?picker=true&__cms_source=invalid.token.here',
    );
    const response = await handler(request);

    // Should be rejected
    assertEquals(response.status, 403);
  });

  await t.step(
    'picker mode: row policy receives ctx.source = plugin:puck',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      await db.insert(media).values([
        {
          title: 'Photo One',
          file: {
            filename: 'photo1.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      // Capture all source values the policy receives. The policy may be called
      // multiple times: once for the picker's row policy (with source) and
      // again for navigation filtering (without source). We verify that at
      // least one call received the expected plugin source.
      const observedSources = new Set<string | undefined>();
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: {
          media: (ctx) => {
            observedSources.add(ctx.source);
            return undefined; // allow
          },
        },
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      assertEquals(
        observedSources.has(pluginSource('puck')),
        true,
        `Expected policy to receive source='${pluginSource('puck')}' but got: ${
          [...observedSources].map((s) => s ?? 'undefined').join(', ')
        }`,
      );
    },
  );

  await t.step(
    'picker mode: expired source token is rejected (403)',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      // Hand-craft a token whose timestamp is well past the 4h TTL.
      // Token format: source.timestamp(base36).signature
      // Signature won't match for an arbitrary timestamp, but the validator
      // rejects on either expired-timestamp or invalid-signature, both of
      // which produce the same observable behaviour: picker mode → 403.
      const expiredToken = `${pluginSource('puck')}.${
        (Date.now() - 5 * 60 * 60 * 1000).toString(36)
      }.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(expiredToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 403);
    },
  );

  await t.step(
    "picker response sets Referrer-Policy: no-referrer and frame-ancestors 'self'",
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      await db.insert(media).values([
        {
          title: 'Photo One',
          file: {
            filename: 'photo1.jpg',
            contentType: 'image/jpeg',
            size: 1024,
          },
        },
      ]);

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      assertEquals(response.headers.get('Referrer-Policy'), 'no-referrer');
      assertEquals(response.headers.get('X-Frame-Options'), 'SAMEORIGIN');

      const csp = response.headers.get('Content-Security-Policy');
      assertEquals(
        typeof csp,
        'string',
        'Content-Security-Policy should be set',
      );
      assertStringIncludes(csp!, "frame-ancestors 'self'");
      // Default CSP had frame-ancestors 'none'; addFrameAncestorSelf should
      // have replaced it with 'self' (combining 'none' with other sources is
      // invalid per spec).
      assertEquals(
        csp!.includes("'none'"),
        false,
        "frame-ancestors 'none' should have been replaced with 'self'",
      );
    },
  );

  await t.step(
    'picker tolerates non-FileReference thumbnail values without crashing',
    async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      await db.execute(sql`
      CREATE TABLE media (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        file JSON,
        secret_notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

      // Mix of weird/legacy values for the file column.
      // The picker must not crash and must still emit a grid item per row.
      await db.execute(
        sql`INSERT INTO media (id, title, file) VALUES
          (1, 'Null File', NULL),
          (2, 'String URL', '"https://example.com/legacy.jpg"'::json),
          (3, 'Empty Object', '{}'::json),
          (4, 'Partial Object', '{"filename": "no-content-type.jpg"}'::json)`,
      );

      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: 'dangerously-open',
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      assertEquals(response.status, 200);
      const html = await response.text();

      // All four rows should render as picker items (label may fall back to ID).
      const itemCount = (html.match(/cms-grid-picker-item/g) ?? []).length;
      // At least one occurrence per row (class may appear multiple times per item).
      assertEquals(
        itemCount >= 4,
        true,
        `expected >= 4 picker items, got ${itemCount}`,
      );
    },
  );

  await t.step(
    'picker returns 400 when thumbnail column is hidden by column policy',
    async () => {
      // If the file column that drives thumbnails is read-hidden for the
      // current user, effectiveThumbnailField is undefined and the picker
      // falls through to the "does not support the image picker" 400 path.
      const client = new PGlite();
      const db = drizzle(client, { schema: schemaWithMedia });

      await db.execute(sql`
        CREATE TABLE media (
          id SERIAL PRIMARY KEY,
          title VARCHAR(200) NOT NULL,
          file JSON,
          secret_notes TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await db.insert(media).values([
        {
          title: 'Hidden file',
          file: {
            filename: 'hidden.jpg',
            contentType: 'image/jpeg',
            size: 512,
          },
        },
      ]);

      // Hide the 'file' column via column policy
      const handler = createCmsHandler({
        csrfSecret: TEST_CSRF_SECRET,
        auth: 'dangerously-open',
        policies: {
          media: {
            columns: {
              file: { read: () => false },
            },
          },
        },
        db,
        schema: schemaWithMedia,
        basePath: '/admin',
      });

      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );

      const request = new Request(
        `http://localhost/admin/media?picker=true&__cms_source=${
          encodeURIComponent(sourceToken)
        }`,
      );
      const response = await handler(request);

      // File column hidden → no thumbnail field → picker not supported
      assertEquals(response.status, 400);
      const html = await response.text();
      assertStringIncludes(html, 'does not support the image picker');
    },
  );
});
