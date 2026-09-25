# @hotsauce/core

Schema introspection, field mapping, and validation for Drizzle ORM.

## Installation

```ts
import { introspectFullSchema, mapColumnToField } from '@hotsauce/core';
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    @hotsauce/core                        │
├─────────────────┬─────────────────┬─────────────────────────┤
│   schema/       │   fields/       │   validation/           │
│                 │                 │                         │
│  Drizzle Table  │  Introspected   │  Zod Schemas            │
│       ↓         │    Column       │  (from drizzle-zod)     │
│  introspect()   │       ↓         │                         │
│       ↓         │  mapToField()   │  createInsertSchema()   │
│  IntrospectedTable  │       ↓     │  createSelectSchema()   │
│                 │   CMSField      │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
        ↓                 ↓                   ↓
   Used by handlers    Used by UI        Used by handlers
   for routing         for rendering     for validation
```

## Modules

### `schema/` - Schema Introspection

Extract metadata from Drizzle tables (columns, types, relations, foreign keys).
Works with any Drizzle dialect (Postgres, MySQL, SQLite).

> **Tested with both Postgres and SQLite schemas** — see `tests/fixtures/` for examples.

| Export                         | Purpose                                        |
| ------------------------------ | ---------------------------------------------- |
| `introspectTable(table)`       | Get metadata for a single table                |
| `introspectSchema(schema)`     | Get metadata for all tables in a schema module |
| `introspectRelations(schema)`  | Extract relation definitions                   |
| `introspectFullSchema(schema)` | Combined tables + relations + junctions        |
| `detectJunctionTables(tables)` | Find many-to-many link tables                  |

**Example:**

```ts
import { introspectTable } from '@hotsauce/core';
import { users } from './schema';

const meta = introspectTable(users);
console.log(meta.name); // 'users'
console.log(meta.primaryKey); // ['id']
console.log(meta.columns); // [{propertyName: 'id', dbName: 'id', dataType: 'number', ...}, ...]
```

### `fields/` - Field Mapping

Map database columns to CMS UI field types.

| Export                         | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `mapColumnToFieldType(column)` | Column → field type (`text`, `number`, `relation`, etc.) |
| `mapColumnToField(column)`     | Full field definition with label, hints                  |
| `mapColumnsToFields(columns)`  | Batch conversion for all columns                         |
| `propertyNameToLabel(name)`    | `authorId` → `"Author Id"`                               |

**Field Types:**

| CMSFieldType | Used For                 |
| ------------ | ------------------------ |
| `text`       | Short strings (varchar)  |
| `textarea`   | Long text (text columns) |
| `number`     | Integers, decimals       |
| `boolean`    | Boolean columns          |
| `date`       | Date-only columns        |
| `datetime`   | Timestamp columns        |
| `select`     | Enum columns             |
| `relation`   | Foreign key references   |
| `json`       | JSON/JSONB columns       |
| `uuid`       | UUID columns             |
| `array`      | Array columns (Postgres) |

**Example:**

```ts
import { mapColumnToField } from '@hotsauce/core';

const field = mapColumnToField(meta.columns[0]);
console.log(field.fieldType); // 'text'
console.log(field.label); // 'Email'
console.log(field.column); // Original column metadata
```

### `extend/` - Column Metadata (`$cms()`)

Optionally patch Drizzle column builders to attach CMS-specific metadata to columns.
This enables schema-authored hints (like file fields) to flow into introspection and field mapping.

**Setup (required for TypeScript):**

Add type declarations to your schema file (one-time setup per project):

```ts
// schema.ts (or a separate cms-types.d.ts file)
import '@hotsauce/core/extend';
import type { CmsColumnOptions, CmsTableOptions } from '@hotsauce/core/extend';

// For PostgreSQL:
declare module 'drizzle-orm/pg-core' {
  interface PgColumnBuilder {
    $cms(options: CmsColumnOptions): this;
  }
  interface PgTable {
    $cms(options: CmsTableOptions): this;
  }
}

// For SQLite:
declare module 'drizzle-orm/sqlite-core' {
  interface SQLiteColumnBuilder {
    $cms(options: CmsColumnOptions): this;
  }
  interface SQLiteTable {
    $cms(options: CmsTableOptions): this;
  }
}

// For MySQL:
declare module 'drizzle-orm/mysql-core' {
  interface MySqlColumnBuilder {
    $cms(options: CmsColumnOptions): this;
  }
  interface MySqlTable {
    $cms(options: CmsTableOptions): this;
  }
}
```

> **Why?** JSR doesn't allow packages to augment external modules. The runtime
> patching works, but TypeScript needs these declarations in your project.

**Usage:**

```ts
import '@hotsauce/core/extend';
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';

const users = pgTable('users', {
  avatar: jsonb('avatar').$cms({ file: true }),
});
```

Notes:

- Importing `@hotsauce/core/extend` patches Drizzle builder prototypes (a global side effect).
- Metadata is stored on the Drizzle column config and is available as `IntrospectedColumn.cmsOptions`.

#### Table-level `$cms()`

You can also call `$cms()` on entire tables to configure table-level CMS options:

```ts
import '@hotsauce/core/extend';
import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

const posts = pgTable('posts', {
  slug: text('slug').notNull(),
  published: boolean('published').default(false),
}).$cms({
  // Generate a "View on site" link for published posts
  frontendUrl: (post) => post.published ? `/blog/${post.slug}` : null,
  label: 'Blog Post', // Singular label (default: table name)
  labelPlural: 'Blog Posts', // Plural label (default: table name + 's')
});
```

**`CmsTableOptions`:**

| Option        | Type                                                | Description                                         |
| ------------- | --------------------------------------------------- | --------------------------------------------------- |
| `autoDraft`   | `boolean`                                           | Auto-create a draft row on "Create New" (see below) |
| `frontendUrl` | `(record: Record<string, unknown>) => string\|null` | Generate a "View on site" link on detail/edit views |
| `label`       | `string`                                            | Singular label for the table (e.g., "Blog Post")    |
| `labelPlural` | `string`                                            | Plural label for lists (e.g., "Blog Posts")         |
| `hidden`      | `boolean`                                           | Hide the table from the CMS sidebar                 |
| `icon`        | `string`                                            | Icon identifier for the sidebar                     |
| `plugins`     | `Record<string, PluginColumnConfig>`                | Plugin-specific configuration (see Plugins section) |

The `frontendUrl` function receives the full record and should return:

- A URL string to show a "View on site ↗" link
- `null` or `undefined` to hide the link (e.g., for draft content)

For security, prefer returning either:

- A relative URL (e.g. `/blog/my-post`)
- An absolute `https://...` (or `http://...`) URL

#### Auto-draft creation

When `autoDraft: true` is set, clicking "Create New" inserts a row with all defaults and redirects to the edit page. This enables features that need a record ID before saving (S3 uploads, Puck editor).

```ts
const media = pgTable('media', {
  id: serial('id').primaryKey(),
  file: jsonb('file'), // nullable — OK
  published: boolean('published').default(false), // has default — OK
}).$cms({ autoDraft: true });
```

Requirements:

- Every non-PK column must have a database default or be nullable
- The CMS validates this at startup and throws `CmsConfigError` if the schema doesn't support it

#### File fields

To model file uploads, mark a JSON/JSONB column with `$cms({ file: true })`.

`CmsColumnOptions` supports:

- `file?: true | { accept?: string; maxSize?: number }`
  - `true` — shorthand: marks as file field with defaults
  - object — explicit MIME/type limits

The default constraints are:

- `accept`: `image/*`
- `maxSize`: `200_000` (200KB)

> **Note:** The S3 storage plugin uses its own default of 10MB. See the
> [S3 plugin docs](../plugins/s3-storage/README.md#file-validation) for details.

#### UI Visibility

Control how fields appear in the CMS UI:

```ts
const posts = pgTable('posts', {
  contentHtml: text('content_html').$cms({ hidden: true }), // Hide from all views
  score: integer('score').$cms({ readOnly: true }), // Show but not editable
});
```

- `hidden?: boolean` — hide from all CMS views (forms, lists, detail). Still saved to DB.
- `readOnly?: boolean` — show the field but prevent editing
- `thumbnail?: boolean` — use this column as the thumbnail in list views. When set on a file or URL column, the table defaults to a grid view with image previews and a toggle to switch to the standard table view. **Only one column per table may have `thumbnail: true`**; the CMS will throw a config error at startup if multiple are found.

> **Note:** `hidden` and `readOnly` are UI hints only. A crafted POST request could still submit values for these columns. To enforce write protection server-side, use column policies with `write: () => false`.

#### Plugin Access Control

Restrict which plugins can write to a column:

```ts
const pages = pgTable('pages', {
  // Only the 'puck' plugin can write to this column
  content: json('content').$cms({ plugins: { puck: true } }),

  // Multiple plugins with explicit permissions
  metadata: json('metadata').$cms({
    plugins: {
      puck: { write: true },
      'block-editor': { write: true, read: true },
    },
  }),
});
```

- `plugins?: Record<string, PluginColumnConfig>` — map of plugin names to access config

**`PluginColumnConfig`:**

| Value             | Meaning                                      |
| ----------------- | -------------------------------------------- |
| `true`            | Shorthand for `{ write: true, read: true }`  |
| `{ write: true }` | Plugin can write to this column              |
| `{ read: true }`  | Plugin can read this column (for future use) |

Use with `policiesFromSchema()` from `@hotsauce/cms` to automatically generate column write policies:

```ts
import { policiesFromSchema } from '@hotsauce/cms';

auth: {
  policies: policiesFromSchema(schema), // Reads $cms({ plugins }) hints
}
```

See the [@hotsauce/cms README](../cms/README.md#schema-derived-policies-policiesfromschema) for details.

#### FileReference Type

File values are stored as a JSON object:

```ts
export type FileReference = {
  filename: string;
  contentType: string;
  size: number;
  data?: string; // base64 (MVP db storage)
  key?: string; // storage key (S3/R2 plugin)
  url?: string; // public URL (CDN/direct access)
  storage?: string; // storage provider ID (e.g., 's3', 'r2')
};
```

For runtime checks, `isValidFileReference(value)` is exported from `@hotsauce/core`.

### `validation/` - Zod Schema Generation

Re-exports from `drizzle-zod` for form validation.

| Export                      | Purpose                         |
| --------------------------- | ------------------------------- |
| `createInsertSchema(table)` | Zod schema for creating records |
| `createSelectSchema(table)` | Zod schema for reading records  |

**Example:**

```ts
import { createInsertSchema } from '@hotsauce/core';
import { users } from './schema';

const insertSchema = createInsertSchema(users);
const result = insertSchema.safeParse(formData);
```

## Types

### `IntrospectedColumn`

```ts
interface IntrospectedColumn {
  propertyName: string; // Drizzle property name, e.g. 'authorId' — the canonical identifier
  dbName: string; // Database column name, e.g. 'author_id' — only for talking to the DB by name
  // Migration: `name` was renamed to `dbName`. Anywhere you indexed a record or
  // a Drizzle table object with `column.name`, use `column.propertyName`.
  // `IntrospectedTable.primaryKey`, `readableColumns`/`writableColumns` from
  // column policies, plugin `field.name`, storage `column` callbacks and file
  // URLs all carry the property name now.
  columnType: string; // e.g., 'PgVarchar', 'SQLiteInteger'
  dataType: string; // e.g., 'string', 'number', 'boolean'
  notNull: boolean;
  hasDefault: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  maxLength?: number;
  enumValues?: readonly string[];
  isArray?: boolean;
  references?: { table: string; column: string };
  cmsOptions?: CmsColumnOptions; // Optional CMS metadata from column $cms()
}
```

### `IntrospectedTable`

```ts
interface IntrospectedTable {
  name: string; // Database table name
  columns: IntrospectedColumn[];
  primaryKey: string[]; // Primary key column(s), as property names, in column order
  table: unknown; // Original Drizzle table reference
  isJunction?: boolean; // True for many-to-many link tables
  cmsOptions?: CmsTableOptions; // Optional CMS metadata from table $cms()
}
```

### `CMSField`

```ts
interface CMSField {
  column: IntrospectedColumn;
  fieldType: CMSFieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  hidden?: boolean;
  readOnly?: boolean;
}
```

## Design Principles

- **Database-agnostic**: Core introspection works with Postgres, MySQL, and SQLite
- **Zero runtime dependencies**: Only uses `drizzle-orm` types at runtime
- **Pure functions**: No side effects, easy to test
- **Explicit types**: All public APIs have TypeScript definitions

## TODO

- [ ] **Custom validation refinements**: SQLite stores UUIDs as plain text, so `drizzle-zod` doesn't automatically validate UUID format. Need a way to attach custom Zod refinements to columns (e.g., via `$withMeta()` or a separate config) that get applied when generating validation schemas.
