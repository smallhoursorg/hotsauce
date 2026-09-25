/**
 * Regression fixture: every column's database name differs from its Drizzle
 * property name.
 *
 * Drizzle keys records, table objects and insert/update payloads by the
 * *property* name (`articleId`), never the database column name
 * (`article_pk`). The CMS therefore treats the property name as the one
 * canonical column identifier — in policies, URLs, form fields, plugin
 * contexts and storage keys — and only reaches for `dbName` when it has to
 * talk to the database by name. Every other fixture in this package happens
 * to use identical names for both, which is why the paths below were broken
 * for a long time without any test noticing.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  integer,
  json,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import '@hotsauce/core/extend';
import { createCmsHandler } from '../mod.ts';
import { generateCsrfToken } from '../csrf.ts';
import {
  generateSourceToken,
  pluginSource,
  SOURCE,
  TEST_CSRF_SECRET,
  TEST_PNG_1X1_RED,
} from './integration_helpers.ts';

// ─────────────────────────────────────────────────────────────
// Schema: property name ≠ database name on every column
// ─────────────────────────────────────────────────────────────

const authors = pgTable('blog_authors', {
  authorId: serial('author_pk').primaryKey(),
  fullName: varchar('full_name', { length: 100 }).notNull(),
});

const tags = pgTable('blog_tags', {
  tagId: serial('tag_pk').primaryKey(),
  tagName: varchar('tag_name', { length: 50 }).notNull(),
});

const articles = pgTable('blog_articles', {
  articleId: serial('article_pk').primaryKey(),
  headline: varchar('headline_text', { length: 200 }).notNull(),
  authorId: integer('author_ref').notNull().references(() => authors.authorId),
  coverImage: json('cover_img').$cms({
    file: { accept: 'image/*' },
    thumbnail: true,
    plugins: { puck: { role: 'source' } },
  }),
  // Audit timestamp recognised by property name only (DB name is unconventional)
  createdAt: timestamp('creation_ts').notNull().defaultNow(),
});

const articleTags = pgTable('blog_article_tags', {
  articleRef: integer('article_ref').notNull().references(() =>
    articles.articleId
  ),
  tagRef: integer('tag_ref').notNull().references(() => tags.tagId),
}, (t) => [primaryKey({ columns: [t.articleRef, t.tagRef] })]);

const schema = { authors, tags, articles, articleTags };

const PNG_BASE64 = btoa(String.fromCharCode(...TEST_PNG_1X1_RED));

async function createTables(db: ReturnType<typeof drizzle>) {
  await db.execute(sql`
    CREATE TABLE blog_authors (
      author_pk SERIAL PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE blog_tags (
      tag_pk SERIAL PRIMARY KEY,
      tag_name VARCHAR(50) NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE blog_articles (
      article_pk SERIAL PRIMARY KEY,
      headline_text VARCHAR(200) NOT NULL,
      author_ref INTEGER NOT NULL REFERENCES blog_authors(author_pk),
      cover_img JSON,
      creation_ts TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE blog_article_tags (
      article_ref INTEGER NOT NULL REFERENCES blog_articles(article_pk),
      tag_ref INTEGER NOT NULL REFERENCES blog_tags(tag_pk),
      PRIMARY KEY (article_ref, tag_ref)
    )
  `);
}

function assertNoBrokenIds(html: string) {
  for (const bad of ['/blog_articles/undefined', '/blog_articles//']) {
    if (html.includes(bad)) {
      throw new Error(`Rendered HTML contains a broken record link: ${bad}`);
    }
  }
}

Deno.test('integration: columns whose DB name differs from property name', async (t) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await createTables(db);

  async function resetDb() {
    await db.execute(sql`
      TRUNCATE TABLE blog_article_tags, blog_articles, blog_tags, blog_authors
      RESTART IDENTITY CASCADE
    `);
    await db.insert(authors).values([
      { fullName: 'Ada Lovelace' },
      { fullName: 'Grace Hopper' },
    ]);
    await db.insert(tags).values([{ tagName: 'history' }, {
      tagName: 'maths',
    }]);
  }

  function createHandler(opts: Record<string, unknown> = {}) {
    return createCmsHandler({
      csrfSecret: TEST_CSRF_SECRET,
      auth: 'dangerously-open',
      policies: 'dangerously-open',
      db,
      schema,
      basePath: '/admin',
      ...opts,
    });
  }

  async function tokens() {
    return {
      __cms_csrf: await generateCsrfToken(TEST_CSRF_SECRET),
      __cms_source: await generateSourceToken(SOURCE.CMS, TEST_CSRF_SECRET),
    };
  }

  await t.step('list (grid + table) links use the real record id', async () => {
    await resetDb();
    await db.insert(articles).values({
      headline: 'Analytical Engine',
      authorId: 1,
      coverImage: {
        filename: 'engine.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: PNG_BASE64,
      },
    });
    const handler = createHandler();

    const grid = await handler(
      new Request('http://localhost/admin/blog_articles'),
    );
    assertEquals(grid.status, 200);
    const gridHtml = await grid.text();
    assertNoBrokenIds(gridHtml);
    // Grid items open the side panel for the record
    assertStringIncludes(gridHtml, '/admin/blog_articles?selected=1');
    // Thumbnail URL must carry the property name: that is what the
    // /files/ route resolves.
    assertStringIncludes(gridHtml, '/admin/files/blog_articles/coverImage/1');

    const table = await handler(
      new Request('http://localhost/admin/blog_articles?view=table'),
    );
    assertEquals(table.status, 200);
    const tableHtml = await table.text();
    assertNoBrokenIds(tableHtml);
    assertStringIncludes(tableHtml, '/admin/blog_articles/1');
    assertStringIncludes(tableHtml, 'Analytical Engine');
    // FK display resolves the related record's PK and display column
    assertStringIncludes(tableHtml, 'Ada Lovelace');
  });

  await t.step(
    'sort accepts the property name and orders the query',
    async () => {
      await resetDb();
      await db.insert(articles).values([
        { headline: 'Apple', authorId: 1 },
        { headline: 'Zebra', authorId: 1 },
      ]);
      const handler = createHandler();

      const desc = await handler(
        new Request(
          'http://localhost/admin/blog_articles?view=table&sort=-headline',
        ),
      );
      const descHtml = await desc.text();
      if (descHtml.indexOf('Zebra') > descHtml.indexOf('Apple')) {
        throw new Error('sort=-headline did not order records descending');
      }

      const asc = await handler(
        new Request(
          'http://localhost/admin/blog_articles?view=table&sort=headline',
        ),
      );
      const ascHtml = await asc.text();
      if (ascHtml.indexOf('Apple') > ascHtml.indexOf('Zebra')) {
        throw new Error('sort=headline did not order records ascending');
      }
    },
  );

  await t.step('create form populates the FK dropdown', async () => {
    await resetDb();
    const handler = createHandler();
    const response = await handler(
      new Request('http://localhost/admin/blog_articles/new'),
    );
    assertEquals(response.status, 200);
    const html = await response.text();
    assertStringIncludes(html, 'name="authorId"');
    // Audit timestamp is recognised by property name and never user-editable
    if (/name="createdAt"(?![^>]*disabled)/.test(html)) {
      throw new Error('createdAt rendered as an editable input');
    }
    assertStringIncludes(html, 'Ada Lovelace');
    assertStringIncludes(html, 'value="1"');
    if (html.includes('value="undefined"') || html.includes('>undefined<')) {
      throw new Error('FK dropdown rendered undefined values');
    }
  });

  await t.step(
    'create redirects to the new record and saves many-to-many rows',
    async () => {
      await resetDb();
      const handler = createHandler();

      const formData = new FormData();
      for (const [k, v] of Object.entries(await tokens())) {
        formData.append(k, v);
      }
      formData.append('headline', 'Compilers');
      formData.append('authorId', '2');
      formData.append('blog_tagsIds', '1');
      formData.append('blog_tagsIds', '2');

      const response = await handler(
        new Request('http://localhost/admin/blog_articles/new', {
          method: 'POST',
          body: formData,
        }),
      );
      assertEquals(response.status, 303);
      assertEquals(
        response.headers.get('Location'),
        '/admin/blog_articles/1',
        'create should redirect to the new record, not the list',
      );

      const rows = await db.select().from(articles);
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.headline, 'Compilers');
      assertEquals(rows[0]?.authorId, 2);

      const links = await db.select().from(articleTags);
      assertEquals(
        links.map((l) => l.tagRef).sort(),
        [1, 2],
        'junction rows should be written for the new record id',
      );
    },
  );

  await t.step(
    'detail view resolves the record and its relations',
    async () => {
      await resetDb();
      await db.insert(articles).values({
        headline: 'Difference Engine',
        authorId: 1,
      });
      await db.insert(articleTags).values({ articleRef: 1, tagRef: 2 });
      const handler = createHandler();

      const response = await handler(
        new Request('http://localhost/admin/blog_articles/1'),
      );
      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'Difference Engine');
      assertStringIncludes(html, 'Ada Lovelace');
      assertStringIncludes(html, 'maths');
    },
  );

  await t.step('edit form pre-selects the FK and update persists', async () => {
    await resetDb();
    await db.insert(articles).values({ headline: 'Draft', authorId: 2 });
    const handler = createHandler();

    const edit = await handler(
      new Request('http://localhost/admin/blog_articles/1/edit'),
    );
    assertEquals(edit.status, 200);
    const editHtml = await edit.text();
    const selected =
      /<option[^>]*value="2"[^>]*selected|<option[^>]*selected[^>]*value="2"/;
    if (!selected.test(editHtml)) {
      throw new Error('edit form did not pre-select the current author');
    }

    const formData = new FormData();
    for (const [k, v] of Object.entries(await tokens())) formData.append(k, v);
    formData.append('headline', 'Published');
    formData.append('authorId', '1');
    const update = await handler(
      new Request('http://localhost/admin/blog_articles/1', {
        method: 'POST',
        body: formData,
      }),
    );
    assertEquals(update.status, 303);
    assertStringIncludes(
      update.headers.get('Location') ?? '',
      '/admin/blog_articles/1',
    );

    const [row] = await db.select().from(articles);
    assertEquals(row?.headline, 'Published');
    assertEquals(row?.authorId, 1);
  });

  await t.step('files route serves the column by property name', async () => {
    await resetDb();
    await db.insert(articles).values({
      headline: 'With cover',
      authorId: 1,
      coverImage: {
        filename: 'cover.png',
        contentType: 'image/png',
        size: TEST_PNG_1X1_RED.length,
        data: PNG_BASE64,
      },
    });
    const handler = createHandler();

    const response = await handler(
      new Request('http://localhost/admin/files/blog_articles/coverImage/1'),
    );
    assertEquals(response.status, 200);
    assertEquals(response.headers.get('Content-Type'), 'image/png');
    await response.arrayBuffer();
  });

  await t.step(
    'picker grid identifies the source column by property name',
    async () => {
      await resetDb();
      await db.insert(articles).values({
        headline: 'Pickable',
        authorId: 1,
        coverImage: {
          filename: 'pick.png',
          contentType: 'image/png',
          size: TEST_PNG_1X1_RED.length,
          data: PNG_BASE64,
        },
      });
      const handler = createHandler();
      const sourceToken = await generateSourceToken(
        pluginSource('puck'),
        TEST_CSRF_SECRET,
      );
      const response = await handler(
        new Request(
          `http://localhost/admin/blog_articles?picker=true&__cms_source=${
            encodeURIComponent(sourceToken)
          }`,
        ),
      );
      assertEquals(response.status, 200);
      const html = await response.text();
      assertStringIncludes(html, 'data-picker-column="coverImage"');
    },
  );

  await t.step(
    'column policy keyed by property name hides the column',
    async () => {
      await resetDb();
      await db.insert(articles).values({ headline: 'Top secret', authorId: 1 });
      const handler = createHandler({
        policies: {
          blog_articles: { columns: { headline: { read: () => false } } },
        },
      });

      const response = await handler(
        new Request('http://localhost/admin/blog_articles/1'),
      );
      assertEquals(response.status, 200);
      const html = await response.text();
      if (html.includes('Top secret')) {
        throw new Error('column policy keyed by property name was not applied');
      }

      // A hidden column cannot be used as a sort key either: that would leak
      // its relative values through row order.
      await db.insert(articles).values({ headline: 'Aardvark', authorId: 2 });
      const sorted = await handler(
        new Request(
          'http://localhost/admin/blog_articles?view=table&sort=headline',
        ),
      );
      const sortedHtml = await sorted.text();
      // Insertion order (Ada's row, then Grace's) must be preserved;
      // ascending headline would put Grace's 'Aardvark' row first.
      if (
        sortedHtml.indexOf('Grace Hopper') < sortedHtml.indexOf('Ada Lovelace')
      ) {
        throw new Error('sort on a policy-hidden column was applied');
      }
    },
  );

  await t.step('delete removes the record', async () => {
    await resetDb();
    await db.insert(articles).values({ headline: 'Gone', authorId: 1 });
    const handler = createHandler();

    const formData = new FormData();
    for (const [k, v] of Object.entries(await tokens())) formData.append(k, v);
    const response = await handler(
      new Request('http://localhost/admin/blog_articles/1/delete', {
        method: 'POST',
        body: formData,
      }),
    );
    assertEquals(response.status, 303);
    const rows = await db.select().from(articles);
    assertEquals(rows.length, 0);
  });

  await client.close();
});
