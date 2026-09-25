# AGENTS.md

Guidelines for AI coding assistants working on this project.

## ⛔ CRITICAL RULES

**Read these first. Violating these will break the project or CI.**

1. **NO `--allow-*` FLAGS** — Run tests with `deno task test` or `deno test -P`. Never pass `--allow-read`, `--allow-env`, `--allow-net`, etc. Permissions are configured in `deno.jsonc`.

2. **STRICT DEPENDENCY POLICY** — Only pre-approved packages are allowed in production (see Dependencies section). Do not suggest adding packages without meeting all approval criteria.

3. **NO `npm`/`yarn`/`pnpm`** — This is a Deno project. Use `deno` commands only.

4. **NO `Deno.*` IN PACKAGES** — Code must be runtime-agnostic. Use Web Standard APIs only (`Request`, `Response`, `crypto`, `fetch`).

---

## Core Constraints

### Dependencies

- **Approved production dependencies:**
  - `drizzle-orm`
  - `postgres` (postgres.js driver)
  - `zod`
  - `drizzle-zod`
  - `@std/media-types` (Deno standard library — MIME type validation for file uploads)
- All approved packages have **zero transitive dependencies** — keep it that way
- Do NOT suggest adding packages without meeting **all** approval criteria:
  1. Zero transitive dependencies
  2. Pure data or pure functions (no runtime-specific APIs)
  3. From a trusted source (Drizzle team or Deno standard library)
  4. Published on JSR with integrity hashes
  5. Could we realistically maintain our own version? (If no, dependency is justified)

### Optional Peer Dependencies

Some features require external packages that users install only if needed:

- **qrcode-generator** — QR code generation for 2FA setup
  - Only required if using built-in password auth with 2FA enabled
  - Not needed for external auth providers (OAuth, SAML, etc.)
  - **Supply chain risk:** This is an npm package outside our control
  - **Recommendation:** Pin to a specific version you have audited
  - Install with: `npm install qrcode-generator@2.0.4`

### Dev Dependencies (testing only)

- `@electric-sql/pglite` — in-memory Postgres for tests
- `sql.js` — in-memory SQLite for tests
- `@std/assert` — Deno standard library assertions
- Dev dependencies are OK since they don't ship to users

### Runtime Compatibility

- All packages must be **runtime-agnostic**
- No `Deno.*` or Node-specific APIs — use Web Standard APIs only
- Handlers use Web Standard `Request`/`Response` (works in Deno, Node 20+, Bun, Workers)
- BYOS (Bring Your Own Server) architecture — users wire handlers to their server

## Package Boundaries

| Package | Purpose                                         | Runtime APIs         | DB-Specific Code | DB-Specific Tests  |
| ------- | ----------------------------------------------- | -------------------- | ---------------- | ------------------ |
| `core`  | Schema introspection, field mapping, validation | ❌ None              | ❌ Generic only  | ✅ PGlite + sql.js |
| `ui`    | HTML generation, form rendering                 | ❌ None              | ❌ Generic only  | ❌ None            |
| `cms`   | CRUD route handlers (Request → Response)        | ❌ Web Standard only | ❌ Generic only  | ✅ PGlite + sql.js |

## Database Guidelines

### Database-Agnostic Design

- Core schema introspection must work with **any** Drizzle schema (pg, mysql, sqlite)
- Use Drizzle's generic types in core, not `drizzle-orm/pg-core` directly
- Database-specific features (arrays, enums, JSON) should:
  - Live in database-specific modules or be feature-detected
  - Degrade gracefully when not available

### Column Identifiers: Property Name Is Canonical

Every introspected column has two names: `propertyName` (the key in the Drizzle
table definition, e.g. `authorId`) and `dbName` (the physical column, e.g.
`author_id`). **`propertyName` is the one identifier the CMS uses everywhere**:

- Drizzle keys records, table objects and insert/update payloads by it
- Column policies, `readableColumns` / `writableColumns`, policy `defaults`
- Form field names, `?sort=` params, `/files/{table}/{column}/{id}` URLs,
  plugin route `:column` params, `data-picker-column`
- Plugin contexts (`ctx.columns`, `field.name`) and storage key prefixes

Reach for `dbName` only when talking to the database by name (raw SQL,
migrations, messages that quote the physical schema). Never index a record or a
Drizzle table object with it. Most fixtures use identical names for both, which
hides mistakes; `packages/cms/tests/integration_mixed_names_test.ts` is the
regression fixture where every column's names differ — extend it when adding a
code path that identifies columns.

### Drizzle ORM Helper Functions

- **Use exported helper functions** instead of direct symbol/property access
- Drizzle exports utilities like `getTableName`, `getTableColumns`, `isTable`
- These provide type-safe access without needing `as unknown as` casts

```typescript
// Good: use Drizzle's helpers
import { getTableColumns, getTableName, Table } from 'drizzle-orm';

const name = getTableName(table); // type-safe
const cols = getTableColumns(table); // returns typed columns object

// Bad: direct symbol access
const TABLE_NAME = Symbol.for('drizzle:Name');
const name = (table as any)[TABLE_NAME]; // loses type safety
```

- For properties without helpers (e.g., foreign keys), use symbol access with appropriate casts
- Check drizzle-orm's exports before adding custom symbol lookups

### Drizzle Compatibility Testing

The CMS extends Drizzle column builders with a `$cms()` method (e.g., to mark JSON columns as file fields). This requires patching Drizzle's `PgColumnBuilder`, `SQLiteColumnBuilder`, and `MySqlColumnBuilder` prototypes and relies on the internal `config` property flowing from builder to built column.

**Why we test Drizzle internals:**

- The `config` property is `protected`, not part of Drizzle's public API
- Class names like `PgColumnBuilder` could be renamed or restructured
- The config flow from builder → column is undocumented behavior

**What the tests verify:**

- Column builder classes exist and are accessible
- The `config` property exists and accepts custom properties
- Custom properties survive method chaining (`.notNull().default()`)
- Custom properties flow from builder to the built column
- Works across Postgres, SQLite, and MySQL

**Files:**

- `drizzle-compat.json` — Version matrix (tested, minimum, known_broken)
- `packages/core/tests/drizzle_compat_test.ts` — 16 compatibility tests
- `packages/core/extend/mod.ts` — Prototype patch that adds `$cms()`
- `packages/core/tests/extend_cms_test.ts` — Ensures `$cms()` metadata is visible via introspection
- `.github/workflows/drizzle-compat.yml` — CI workflow (matrix, latest, daily checks)

**When tests fail after a Drizzle upgrade:**

1. Check if the internal API changed
2. Update our prototype patch if needed
3. Add the broken version to `known_broken` in drizzle-compat.json
4. Document the minimum working version

### Feature Detection Pattern

```typescript
// Good: detect capabilities
const capabilities = detectCapabilities(schema);
if (capabilities.arrays) {
  // handle array fields
}

// Bad: assume a specific database
import { pgTable } from 'drizzle-orm/pg-core';
```

## Code Style

- Prefer **functions over classes** for utilities
- Use **explicit types** for public API function signatures
- Use **template literals** for HTML generation (no JSX in core/ui)
- Keep functions **pure** where possible — side effects in server packages

### UI Package Guidelines

- Use the `html` tagged template from `packages/ui/html.ts` for XSS-safe HTML
- Interpolated values are auto-escaped; use `raw()` for trusted HTML
- Use `attrs()` helper to build attribute strings safely
- HTML5 validation attributes (required, maxlength, pattern) for client-side validation
- No client-side JavaScript dependencies — pure server-rendered HTML
- All form submissions use standard `<form>` POST — no AJAX

```typescript
// Good: auto-escaped template
import { attrs, html, raw } from '@hotsauce/ui';

html`
  <input ${attrs({ name, value: userInput })} />
`; // userInput is escaped
html`
  <div>${raw(trustedHtml)}</div>
`; // explicitly trusted

// Bad: string concatenation
`<input value="${userInput}" />`; // XSS vulnerability
```

## File Organization

Each package has a README with detailed API documentation:

- [`packages/core/README.md`](packages/core/README.md) — Schema introspection, field mapping
- [`packages/ui/README.md`](packages/ui/README.md) — HTML generation, forms, views
- [`packages/cms/README.md`](packages/cms/README.md) — CRUD handlers, routing

```
packages/core/
├── mod.ts              # Main entry, re-exports public API
├── README.md           # Package documentation
├── schema/
│   ├── introspect.ts   # Extract metadata from Drizzle schemas
│   └── types.ts        # Shared type definitions
├── fields/
│   └── mapping.ts      # Column type → CMS field mapping
└── validation/
    └── zod.ts          # Re-exports drizzle-zod

packages/ui/
├── mod.ts              # Main entry
├── README.md           # Package documentation
├── html.ts             # Tagged template with auto-escaping
├── styles.ts           # CSS stylesheet content
├── forms/
│   ├── inputs.ts       # Individual input renderers (text, select, etc.)
│   ├── field.ts        # Form field with label/error wrapper
│   └── form.ts         # Complete form with fields and buttons
├── views/
│   ├── list.ts         # Table listing records
│   ├── detail.ts       # Single record view
│   └── edit.ts         # Edit/create form view
└── components/
    ├── layout.ts       # Page layout, sidebar
    ├── alert.ts        # Flash messages
    └── pagination.ts   # Page navigation

packages/cms/
├── mod.ts              # Main entry, exports createCmsHandler
├── README.md           # Package documentation
├── router.ts           # URL routing and method dispatch
├── crud.ts             # List, create, read, update, delete handlers
├── crud-helpers.ts     # Internal CRUD utilities
├── http.ts             # Response helpers, form parsing
├── csrf.ts             # CSRF token generation and validation
├── styles.ts           # Stylesheet route handler
├── validation.ts       # Zod config validation
├── runtime-compat.ts   # Cross-runtime env var utilities (getEnv)
├── types.ts            # Handler types (CmsOptions, ErrorContext, etc.)
├── auth/               # JWT authentication module
├── tokens/             # Token generation and validation
│   ├── crypto.ts       # HMAC-SHA256 primitives (signPayload, verifyPayload)
│   ├── csrf.ts         # CSRF token (re-exported from ../csrf.ts)
│   ├── source.ts       # Source tokens (identify CMS vs plugin forms)
│   └── mod.ts          # Re-export public API
├── policies/           # Row and column-level security
│   ├── types.ts        # Policy, TablePolicy, ColumnPolicies types
│   ├── helpers.ts      # ownedBy, adminOr, readOnly, etc.
│   ├── apply.ts        # Policy evaluation and application
│   ├── from-schema.ts  # policiesFromSchema() - generate from $cms() hints
│   └── mod.ts          # Re-export public API
└── plugins/            # Plugin registry, service, and types
    ├── types.ts        # Plugin, PluginConfig, re-exports from workers
    ├── registry.ts     # Plugin registration and validation
    └── service.ts      # Plugin execution orchestration

packages/workers/
├── mod.ts              # Main entry, exports WorkerExecutor
├── README.md           # Package documentation
├── types.ts            # Serializable, PluginContext, ActionContext, etc.
└── executor.ts         # Worker management and communication

packages/plugins/
├── mod.ts              # Main entry, re-exports plugins and types
├── README.md           # Package documentation
└── audit-log/
    ├── mod.ts          # Type exports for DX (AuditLogConfig)
    └── worker.ts       # Worker module (handles messages directly)
```

## Environment Variables

The CMS uses these environment variables for secrets (can also be passed directly):

| Variable          | Purpose                                 |
| ----------------- | --------------------------------------- |
| `CMS_2FA_SECRET`  | 2FA challenge token signing (32+ chars) |
| `CMS_CSRF_SECRET` | CSRF token signing (32+ chars)          |
| `CMS_JWT_SECRET`  | JWT signing for auth (32+ chars)        |

## Authorization & Policy Model

The CMS uses a **layered security model** for authorization. Understanding this prevents accidental "fixes" that break intended behavior.

### Security Layers (in order)

1. **Type-level enforcement** (`CmsOptions` in `types.ts`)

- When `auth` is configured, `policies` is **required** at the top level by TypeScript
- Forces developers to explicitly choose an authorization strategy
- Options: `policies: { ... }`, `policies: {}`, or `policies: 'dangerously-open'`

2. **Zod validation at startup** (`validateCmsOptions` in `validation.ts`)
   - Validates entire config when `createCmsHandler()` is called
   - Throws `CmsConfigError` with detailed messages for invalid config

- Enforces: `policies` required when auth is configured

3. **Runtime column policy column policy validation** (`crud.ts` handlers)
   - If auth is enabled but policies somehow undefined, handlers return 403
   - **Validates hidden required columns** — checks if required columns missing from `writableColumns` have policy defaults
   - Returns clear error message if misconfigured (catches issues that depend on user context)

4. **Policy application** (`applyPolicy` in `policies/apply.ts`)
   - Low-level utility that evaluates a single policy
   - **Intentionally returns `allowed: true` when policy is undefined**
   - By this point, the caller has already validated the configuration

5. **Column policy evaluation** (`evaluateColumnPolicies` in `policies/apply.ts`)
   - Determines which columns are readable/writable for current user
   - Returns `EvaluatedColumnPolicies` with `readableColumns`, `writableColumns`, `defaults`
   - Data filtering happens in CRUD handlers before any response

### Row vs Column Policies

**Row policies** filter which records a user can access (WHERE clause injection):

```typescript
auth: {
  provider: new PasswordProvider({ db, usersTable: schema.adminUsers }),
},
policies: {
  posts: ownedBy(schema.posts, 'authorId'), // Row-only
},
```

**Column policies** filter which fields within records are visible/editable:

```typescript
auth: {
  provider: new PasswordProvider({ db, usersTable: schema.adminUsers }),
},
policies: {
  posts: {
    row: ownedBy(schema.posts, 'authorId'),   // Row filter
    columns: {                                  // Column filter
      salary: { read: adminOnly, write: adminOnly },
      tenantId: { read: () => false, write: () => false, default: getTenant },
    },
  },
},
```

The `TablePolicy` type enables either pattern:

```typescript
// Row-only policy (backward compatible)
type Policy = PolicyFn | { [action]: PolicyFn };

// Combined row + column policy
type TablePolicy = {
  row?: Policy;
  columns?: ColumnPolicies;
};

// Both are valid values in Policies object
type Policies = Record<string, Policy | TablePolicy>;
```

### Column Policy Evaluation Flow

1. **Handler extracts policies** — `extractRowPolicy()` and `extractColumnPolicies()` separate concerns
2. **Columns evaluated** — `evaluateColumnPolicies()` runs `read`/`write` functions for each column
3. **Data filtered** — `filterRecordColumns()` removes hidden columns from response data
4. **Forms filtered** — Only writable columns shown in create/edit forms
5. **Defaults injected on create** — `injectColumnDefaults()` adds values for non-writable columns

### Hidden Required Column Validation

This is validated **at runtime** during create operations when we have user context:

```typescript
// crud.ts → handleCreate()
// After evaluating column policies with actual user context:
// If column is NOT NULL + no DB default + not in writableColumns + no policy default
// → Returns error message in form
```

Example error:

```
Configuration error: Column 'tenantId' is required (NOT NULL) but hidden from this user without a default.
Either provide a 'default' function in the column policy, add a database default, or make the column nullable.
```

> **Why runtime?** Column policies are functions that depend on user context (e.g., `write: (ctx) => ctx.user?.role === 'admin'`). We can't know at startup whether a column will be writable for every possible user.

### Why `applyPolicy(undefined, ...)` returns `allowed: true`

This is **intentional, not a security bug**. The semantic meaning:

> "I have a `Policies` object, but this specific table has no entry"

Per the documented behavior: "Tables without an explicit policy get full access."

This matches PostgreSQL RLS semantics and provides good DX — you only define policies for tables that need restrictions.

### Do NOT "fix" by changing the default

Changing `applyPolicy` to return `allowed: false` would:

- Break the documented API contract
- Cause silent failures for unlisted tables
- Force verbose `() => undefined` policies for every table
- Push users toward `'dangerously-open'` to avoid friction

## Development Environment

- **Deno is the primary development runtime** — no Node.js/npm required locally
- All commands use `deno` CLI
- Do NOT suggest `npm`, `npx`, `yarn`, or `pnpm` commands for development
- Node compatibility is achieved via JSR publishing and `dnt` build step

### Deno Permissions

- **ALWAYS use `deno task test`** or `deno test -P --parallel` — never pass `--allow-*` flags manually
- **For debugging**, use `deno task test:debug` or `deno test -P` (sequential execution)
- **Never use broad permission flags** like `--allow-env`, `--allow-read`, `--allow-net`, `--allow-ffi`
- **Never set `"read": true`** or any permission to `true` in config
- All test permissions are pre-configured in `deno.jsonc` under `test.permissions`
- Specify exact paths, hosts, and env vars needed
- Use `DENO_DIR=.deno_cache` to keep npm cache local and permission-friendly
- Example:
  ```jsonc
  "permissions": {
    "read": ["./packages", "./.deno_cache"],
    "env": ["DATABASE_URL"],
    "net": ["localhost:5432"]
  }
  ```

## Testing

- Run tests with `deno task test` or `deno test -P --parallel` (fast, parallel execution)
- For debugging test failures, use `deno task test:debug` or `deno test -P` (sequential)
- Tests should run on both Deno and Node where applicable (CI will test Node)
- Use `Deno.test()` for all test files
- Core/UI tests should be runtime-agnostic (test the logic, not the runtime)

### Test File Organization

```
packages/core/tests/
├── schema_test.ts       # Schema metadata inspection (Postgres + SQLite)
├── introspect_test.ts   # Table/relation introspection
├── mapping_test.ts      # Column → field mapping
├── validation_test.ts   # Zod schema generation (Postgres + SQLite)
├── integration_test.ts  # PGlite + sql.js database tests
└── fixtures/
    ├── schema-pg.ts     # Postgres test schema
    └── schema-sqlite.ts # SQLite test schema
```

- **Schema tests**: Verify Drizzle exposes expected metadata on tables/columns
- **Integration tests**: Verify test fixtures work with real in-memory databases
- Both Postgres and SQLite schemas are tested to ensure cross-database compatibility

## Common Mistakes to Avoid

1. **Adding dependencies** — find a zero-dep solution or use built-in APIs
2. __Using Deno._ in core_* — breaks Node compatibility
3. **Hardcoding database-specific types in core** — breaks extensibility
4. **Mixing concerns** — keep schema logic, UI, and HTTP handling separate
5. **Forgetting feature detection** — not all DBs support arrays, enums, JSON, etc.
6. **Silent failures** — errors should either be logged via `onError` and/or block the operation with a user-facing message; never silently pass through

## Internal Design Notes (Reference)

### Source Tokens and Picker Mode

Source tokens identify the origin of a CMS request. They are HMAC-SHA256 signed with `CMS_CSRF_SECRET`, have a 4-hour TTL, and carry the value `'cms'` for core forms or `'plugin:{name}'` for plugin requests (e.g., `'plugin:puck'`).

**Picker mode** is a separate rendering path in `handleList` that serves a stripped-down grid for the Puck `ImagePickerField`. It is gated by two independent checks: a valid admin session (JWT cookie) and a valid source token in `?__cms_source=`. The source token prevents other CMS pages from loading the picker grid directly and ensures `ctx.source` is populated in row policies.

Key invariants — do not break these:

- **Plugin name comes from the signed token**, not the URL. Changing how the plugin name is extracted (see `getPluginName` in `packages/cms/tokens/source.ts`) affects which columns are exposed to the picker.
- **`role: 'source'` is the picker opt-in.** Only columns marked `$cms({ plugins: { puck: { role: 'source' } } })` appear in picker payloads. Adding data to picker responses without this opt-in would be a data-exposure regression.
- **`CmsContext.sourceToken`** is injected into `globalThis` before user component bundles load (see `packages/plugins/puck/client/main.tsx`). It is accessible to all code in the user's bundle. Do not expand what this token can access without considering that it is visible to third-party component code.

When modifying `packages/cms/tokens/source.ts`, `packages/cms/crud.ts` (picker branch of `handleList`), or `packages/plugins/puck/`, run `deno task test packages/cms/tests/integration_picker_test.ts` to verify picker behaviour.

### Plugin Architecture

Plugins extend the CMS with custom hooks that run during CRUD operations. Key design decisions:

**Worker Isolation (Security)**

- Plugins run in Web Workers, isolated from the main thread
- Plugins never receive database handles, server internals, or functions
- All data crossing the Worker boundary must be JSON-serializable
- This "secure by default" approach protects against malicious or buggy plugins

**User-Provided Workers**

- Users create their own `Worker` instance with desired permissions
- Gives full control over isolation (Deno permissions, Node policies, etc.)
- The CMS sends messages to the Worker; plugin code runs entirely inside

```typescript
// User creates Worker with explicit permissions
const auditWorker = new Worker(
  import.meta.resolve('@hotsauce/plugins/audit-log/worker'),
  {
    type: 'module',
    deno: { permissions: { net: ['audit.example.com'] } },
  },
);

// Plugin config references the Worker
plugins: [
  {
    name: 'audit-log',
    worker: auditWorker,
    // Declarative: list which hooks the Worker handles
    hooks: { on: ['create', 'update', 'delete'] },
    filter: (ctx) => !['sessions', 'audit_logs'].includes(ctx.table), // Skip noisy/recursive tables
    config: { webhookUrl: 'https://audit.example.com/events' },
  },
];
```

**Filter Function (Data Flow Security)**

- `filter: ((ctx: FilterContext) => boolean) | 'dangerously-open'` is **REQUIRED**
- Controls what data flows to plugins — this is a **security feature**
- Prevents unintentional data exposure to third-party plugin code
- Use `'dangerously-open'` to explicitly allow all data (acknowledge the risk)
- FilterContext: `{ hookType, table, action, user }`
- HookType: `'transform:beforeSave' | 'transform:afterRead' | 'action'`

```typescript
// Good: explicit filter prevents sending sensitive tables to plugin
filter: ((ctx) => !['users', 'sessions', 'payments'].includes(ctx.table));

// Good: only send specific actions
filter: ((ctx) =>
  ctx.hookType === 'action' && ['create', 'update'].includes(ctx.action));

// Explicit opt-in to send everything (use with caution)
filter: 'dangerously-open';
```

**Hook Categories**

- **Transform hooks** (`beforeSave`, `afterRead`): Modify data, always block
- **Action hooks** (`on.create`, `on.update`, etc.): Side effects, optionally fire-and-forget
- **UI hooks** (`ui.renderField`): Customize field rendering in admin UI (runs in Workers or in-process; return type is serializable)

**Schema-Driven Scoping (Security)**

Plugins are **schema-driven by default**: they only receive data for tables/columns that declare them via `$cms({ plugins: { pluginName: ... } })`. This is secure-by-default — plugins never see undeclared data.

- **Column-scoped**: Plugin declared on columns → receives only those columns' values
- **Table-scoped**: Plugin declared on table → receives full record
- `filter: 'dangerously-open'` bypasses scoping (receive all data)

Plugins receive `ctx.columns` with configuration for each declared column:

```typescript
// Schema
content: text('content').$cms({ plugins: { markdown: { role: 'source', output: 'contentHtml' } } }),
contentHtml: text('content_html').$cms({ plugins: { markdown: { role: 'output' } } }),

// Plugin beforeSave receives:
// ctx.columns = { content: { role: 'source', output: 'contentHtml' }, contentHtml: { role: 'output' } }
// data = { content: "# Hello", contentHtml: null }  (only declared columns)
```

**Column Policy Interaction**

Transform hooks (`afterRead`) receive **column-filtered** records. Hidden columns are removed _before_ plugins see the data. This is intentional for security — plugins cannot access or leak column-policy-hidden data.

**Declarative vs Function Hooks**

Worker plugins use **declarative hooks** (arrays of hook names), while in-process plugins use **function hooks**:

```typescript
// Worker plugin: declarative hooks (functions live in Worker module)
{
  name: 'audit-log',
  worker: auditWorker,
  hooks: {
    on: ['create', 'update', 'delete'],  // Array of action names
  },
  // No filter needed - schema-driven by table declaration
}

// In-process plugin: function hooks (run in main thread)
{
  name: 'markdown',
  hooks: {
    transform: {
      beforeSave: (ctx, data) => {
        // ctx.columns has per-column config
        for (const [col, config] of Object.entries(ctx.columns)) {
          if (config.role === 'source' && config.output) {
            data[config.output] = transform(data[col]);
          }
        }
        return data;
      },
    },
  },
  // No filter needed - schema-driven by column declarations
}
```

This distinction is enforced at registration time:

- Worker plugins with function hooks will be rejected (confusing - functions never run)
- In-process plugins with declarative hooks will be rejected

**Serializable Constraint**

- All data passed to plugins: `Serializable` type (primitives, arrays, plain objects, Date)
- No functions, class instances, symbols, or circular references
- Plugins receive snapshots of data, not live references

### Plugin Development Guidelines

When creating plugins:

1. **Use schema-driven scoping** — no `filter` needed; declare columns/tables in schema with `$cms({ plugins: { yourPlugin: config } })`
2. **Read config from `ctx.columns`** — each declared column's config is available at hook time
3. **Keep Worker module self-contained** — it cannot import from main thread modules
4. **Declare capabilities** — network hosts, actions needed (for documentation and validation)
5. **Use `blocking: false`** for logging/analytics that shouldn't block requests
6. **Use declarative hooks for Workers** — `hooks: { on: ['create'] }` instead of functions
7. **Use `'dangerously-open'`** only for plugins that truly need all data (audit logging)

### Plugin Column Roles Convention

Plugins discover which columns to operate on via schema metadata. The `$cms()` method marks columns with plugin configuration:

```typescript
// Puck visual editor - role defaults to 'data' (the authoritative data column)
content: jsonb('content').$cms({ plugins: { puck: true } });

// Markdown transform - source column with reference to output
content: text('content').$cms({
  plugins: { markdown: { role: 'source', output: 'contentHtml' } },
});

// Output column - automatically hidden from forms
contentHtml: text('content_html').$cms({
  plugins: { markdown: { role: 'output' } },
});
```

**Role Types:**

| Role     | Form Behavior                              | Use Case             |
| -------- | ------------------------------------------ | -------------------- |
| `data`   | Show in form, plugin may provide custom UI | Puck JSON, rich text |
| `source` | Show in form, triggers transform           | Markdown input       |
| `output` | Hidden from form (computed)                | Rendered HTML, slugs |

**CMS Behavior:**

- `role: 'output'` columns are automatically hidden (like `$cms({ hidden: true })`)
- `role: 'source'` with `output` allows plugins to discover transform pairs
- `role: 'data'` (default) means the plugin owns the column's editing experience

**Forward Compatibility:**

This pattern works for any transform plugin (slugify, search indexing, image thumbnails):

```typescript
title: text().$cms({
  plugins: { slugify: { role: 'source', output: 'slug' } },
});
slug: text().$cms({ plugins: { slugify: { role: 'output' } } });
```

### Uploads: What belongs in core vs plugin

**First-class (core)** (so the CMS feels complete even without storage):

- A `file` field type in the field mapping + UI rendering contract
- A standard file reference shape stored in tables (e.g. `{ key/id, filename, contentType, size, url? }` or an `uploadId` FK)
- Basic display conventions (filename/size; link when `url` exists)
- Core can render + validate a file reference; core does not move bytes

**Official plugin** (environment + storage concerns):

- Multipart parsing + upload endpoints
- Storage adapter calls (`put/get/delete`)
- Optional direct-to-bucket / presigned URL flow (S3/R2-style)
- Virus scanning / transformations (if ever)
- Cleanup policies (orphan GC, retention)

## GitHub CLI Notes

When replying to PR review comments (not just commenting on the PR):

```bash
# Reply to a specific review comment (use in_reply_to)
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments -X POST \
  -f body="Your reply" \
  -F in_reply_to=COMMENT_ID

# NOT this (creates new top-level PR comment):
gh pr comment PR_NUMBER --body "..."
```

The `in_reply_to` field links the reply to the specific review comment thread.
