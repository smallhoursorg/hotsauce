// Handler types and options

import type { IntrospectedSchema, IntrospectedTable } from '@hotsauce/core';
import type { AuthProvider, JwtPayload, SameSite } from '@hotsauce/auth';
import type { Policies } from './policies/types.ts';
import type { PluginConfig, PluginErrorContext } from './plugins/types.ts';
import type { PluginRegistry } from './plugins/registry.ts';
import type { PluginService } from './plugins/service.ts';

// ─────────────────────────────────────────────────────────────
// Storage types - for file upload/download providers
// ─────────────────────────────────────────────────────────────

/**
 * Unique identifier for a storage provider instance.
 * @example 's3', 'r2', 'minio-backup', 'tenant-uploads'
 */
export type StorageId = string;

/**
 * Context for resolving which storage provider to use for uploads.
 * Passed to the `resolveStorage` callback during presign operations.
 */
export interface ResolveStorageContext {
  /** The original HTTP request */
  request: Request;
  /** Authenticated user info (null if no auth) */
  user: { sub: string; role?: string; [key: string]: unknown } | null;
  /** Table name being operated on */
  table: string;
  /** File column, as its Drizzle property name (e.g. `coverImage`) */
  column: string;
  /** Action being performed */
  action: 'create' | 'update';
  /** Record ID (for updates) */
  recordId?: string;
}

/**
 * Function to determine which storage provider to use for a new upload.
 * Called during presign operations.
 *
 * Return `undefined` to use inline database storage for this column.
 *
 * @example
 * ```ts
 * // Route by table
 * resolveStorage: (ctx) => ctx.table === 'backups' ? 'archive' : 'primary'
 *
 * // Route by tenant (from JWT claims)
 * resolveStorage: (ctx) => `tenant-${ctx.user?.tenantId}`
 *
 * // Keep avatars in database, everything else to S3
 * resolveStorage: (ctx) => ctx.column === 'avatar' ? undefined : 's3'
 * ```
 */
export type ResolveStorageFn = (
  ctx: ResolveStorageContext,
) => StorageId | undefined;

/**
 * Context for presigning an upload URL.
 */
export interface PresignContext extends ResolveStorageContext {
  /** Original filename from client */
  filename: string;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  size: number;
}

/**
 * Result from presigning an upload URL.
 */
export interface PresignResult {
  /** The generated unique object key */
  key: string;
  /** Upload instructions for the client */
  upload: {
    /** HTTP method (usually PUT) */
    method: string;
    /** Presigned upload URL */
    url: string;
    /** Headers the client must send */
    headers?: Record<string, string>;
  };
}

/**
 * Context for signing a download URL.
 */
export interface SignDownloadContext {
  /** Storage provider ID */
  storage: StorageId;
  /** Object key */
  key: string;
  /** Optional filename for Content-Disposition */
  filename?: string;
  /** Original request (for tenant context if needed) */
  request?: Request;
  /** User context (for tenant-aware signing) */
  user?: { sub: string; role?: string; [key: string]: unknown } | null;
}

/**
 * Context for deleting an object from storage.
 */
export interface DeleteContext {
  /** Storage provider ID */
  storage: StorageId;
  /** Object key to delete */
  key: string;
  /** Original request (for tenant context if needed) */
  request?: Request;
  /** User context (for tenant-aware operations) */
  user?: { sub: string; role?: string; [key: string]: unknown } | null;
}

/**
 * Context for cache invalidation.
 */
export interface InvalidateContext {
  /** Storage provider ID */
  storage: StorageId;
  /** Object key to invalidate */
  key: string;
  /** Public URL (if known) */
  url?: string;
}

/**
 * Storage provider interface.
 *
 * Providers implement this interface to enable presigned uploads and signed downloads.
 * The interface is intentionally storage-agnostic - no S3/bucket concepts in the core type.
 *
 * Plugins register providers via `storageProvider` field in their config.
 * The CMS extracts these during init and builds a registry.
 *
 * @example
 * ```ts
 * const s3Provider: StorageProvider = {
 *   id: 's3-uploads',
 *   kind: 's3',
 *   presignUpload: async (ctx) => ({ key: '...', upload: { method: 'PUT', url: '...' } }),
 *   signDownloadUrl: async (ctx) => 'https://...',
 *   deleteObject: async (ctx) => { ... },
 * };
 * ```
 */
export interface StorageProvider {
  /** Unique identifier for this provider instance */
  id: StorageId;

  /**
   * Provider kind for documentation/debugging.
   * Does not affect behavior - just metadata.
   */
  kind: 'db-inline' | 's3' | 'custom';

  /**
   * Generate a presigned upload URL.
   * Called when preparing for a direct-to-storage upload.
   * Optional - providers without this use server-side upload.
   */
  presignUpload?: (ctx: PresignContext) => Promise<PresignResult>;

  /**
   * Generate a signed download URL.
   * Called when serving files via /files/{table}/{column}/{id}.
   * Optional - providers without this cannot serve files via redirect.
   */
  signDownloadUrl?: (ctx: SignDownloadContext) => Promise<string>;

  /**
   * Delete an object from storage.
   * Called when file fields are cleared or replaced.
   * Optional - if not implemented, orphaned files accumulate.
   */
  deleteObject?: (ctx: DeleteContext) => Promise<void>;

  /**
   * List objects under a key prefix.
   * Called after update/delete to clean up orphaned files in the same prefix.
   * Optional - if not implemented, only the specific old key is deleted.
   */
  listObjects?: (
    prefix: string,
  ) => Promise<Array<{ key: string; lastModified: Date; size: number }>>;

  /**
   * Invalidate CDN cache for an object.
   * Called after deletion/replacement if the provider supports it.
   * Optional - most providers don't need this with unique keys.
   */
  invalidateCache?: (ctx: InvalidateContext) => Promise<void>;
}

/**
 * Storage configuration for CMS.
 *
 * Can be:
 * - `StorageId` (string): All files go to that storage provider
 * - `ResolveStorageFn`: Dynamic routing based on context
 *
 * Return `undefined` from the function to use inline database storage.
 *
 * @example
 * ```ts
 * // Simple: all files go to S3
 * storage: 's3'
 *
 * // Dynamic: avatars stay in DB, everything else to S3
 * storage: (ctx) => ctx.column === 'avatar' ? undefined : 's3'
 *
 * // Route by table
 * storage: (ctx) => ctx.table === 'backups' ? 'archive' : 's3'
 * ```
 */
export type StorageOptions = StorageId | ResolveStorageFn;

/**
 * Internal storage registry built from plugin providers.
 */
export interface StorageRegistry {
  /** Provider instances keyed by ID */
  instances: Map<StorageId, StorageProvider>;

  /** Default provider for new uploads */
  defaultObjectStorageId?: StorageId;

  /** Resolver function */
  resolveStorage?: ResolveStorageFn;
}

/**
 * A Web Standard handler function: Request → Response
 */
export type Handler = (request: Request) => Promise<Response> | Response;

/**
 * Parser function signature (validation-library agnostic)
 * Takes unknown data and returns parsed/validated data or throws on error
 */
export type ParserFn = (data: unknown) => unknown;

/**
 * Parsers for a single table
 * Only insert and update are used - select validation is not needed for CMS
 */
export interface TableParsers {
  /** Parser for insert operations (new records) */
  insert?: ParserFn;
  /** Parser for update operations (existing records) */
  update?: ParserFn;
}

/**
 * User-provided parsers keyed by table name
 * If not provided for a table, drizzle-zod schemas are generated automatically
 */
export type Parsers = Record<string, TableParsers>;

/**
 * CRUD action types
 */
export type CrudAction = 'list' | 'read' | 'create' | 'update' | 'delete';

/**
 * Context passed to error handler.
 *
 * Discriminated union: narrow on `source` to determine what context is available.
 * - `'handler'`: Error in an HTTP request handler (has request, url, route)
 * - `'plugin'`: Error in a plugin (fire-and-forget or async; has plugin name, operation, hookContext)
 */
export type ErrorContext = HandlerErrorContext | PluginErrorContext;

/**
 * Error context from an HTTP request handler.
 * Always has the Request and URL that was being processed.
 */
export interface HandlerErrorContext {
  source: 'handler';
  /** The original request */
  request: Request;
  /** Parsed URL */
  url: URL;
  /** Route info (may be null if error occurred before routing) */
  route: ParsedRoute | null;
  /** The table being accessed (if any) */
  table?: IntrospectedTable;
  /** The action being performed (if any) */
  action?: CrudAction | 'dashboard';
  /** Request ID for correlating logs with user-facing error messages */
  requestId?: string;
  /** Plugin name (when the error originated from a plugin within a handler) */
  plugin?: string;
}

// PluginErrorContext (from @hotsauce/workers) already has source: 'plugin'
// and is used directly in the ErrorContext union above.

/**
 * Custom Content Security Policy directives.
 * Origins are appended to the CMS defaults (e.g. 'self' is always included).
 *
 * @example
 * ```ts
 * csp: { imgSrc: ['https://my-bucket.s3.amazonaws.com'] }
 * ```
 */
export interface CspOptions {
  /** Additional origins for img-src (images, favicons) */
  imgSrc?: string[];
  /** Additional origins for connect-src (fetch, XHR, WebSocket) */
  connectSrc?: string[];
  /** Additional origins for frame-src (iframes) */
  frameSrc?: string[];
  /** Additional sources for style-src (e.g., "'unsafe-inline'" for runtime styles) */
  styleSrc?: string[];
}

/**
 * Base options shared by all CMS configurations
 */
export interface CmsOptionsBase {
  /**
   * Drizzle database instance.
   *
   * Uses `any` intentionally for cross-dialect compatibility (Postgres, MySQL, SQLite).
   * There's no common base type across Drizzle dialects, and importing all dialect types
   * would add dependencies.
   */
  // deno-lint-ignore no-explicit-any
  db: any;
  /** Drizzle schema object (e.g., { users, posts }) */
  // deno-lint-ignore no-explicit-any
  schema: Record<string, any>;
  /** Base path for CMS routes (default: '/admin') */
  basePath?: string;
  /** Site title for the admin UI */
  title?: string;
  /**
   * Secret for CSRF token signing (HMAC-SHA256).
   * Must be at least 32 characters of entropy.
   *
   * If not provided, falls back to CMS_CSRF_SECRET environment variable.
   * If neither is set, createCmsHandler() throws an error.
   *
   * Generate with `openssl rand -base64 32` and store in an environment variable.
   *
   * @example
   * ```ts
   * // Option 1: Pass directly
   * csrfSecret: process.env.CMS_CSRF_SECRET!,
   *
   * // Option 2: Set CMS_CSRF_SECRET env var, omit from options
   * // createCmsHandler({ db, schema }) // uses CMS_CSRF_SECRET
   * ```
   */
  csrfSecret?: string;
  /** Custom authentication check */
  isAuthenticated?: (request: Request) => Promise<boolean> | boolean;
  /**
   * Error handler for unexpected errors.
   *
   * Called when an unexpected error occurs (database failures, etc.).
   * Use this to log errors to your monitoring service (Sentry, Datadog, etc.).
   * The user receives a generic 500 response regardless.
   *
   * @example
   * ```ts
   * onError: (error, context) => {
   *   logger.error('CMS error', {
   *     message: error.message,
   *     stack: error.stack,
   *     path: context.url.pathname,
   *     table: context.table?.name,
   *     action: context.action,
   *   });
   * }
   * ```
   */
  onError?: (error: Error, context: ErrorContext) => void;
  /**
   * Custom parsers for validation (optional).
   *
   * If not provided, drizzle-zod schemas are generated automatically.
   * Use this to add custom validation rules (e.g., email format, min/max length).
   *
   * @example
   * ```ts
   * parsers: {
   *   users: {
   *     insert: (data) => usersInsertSchema.parse(data),
   *     update: (data) => usersUpdateSchema.parse(data),
   *   }
   * }
   * ```
   */
  parsers?: Parsers;

  /**
   * Plugins to extend CMS functionality.
   *
   * Plugins can provide UI customizations (custom field renderers),
   * data transformations, and action hooks.
   *
   * @example
   * ```ts
   * plugins: [
   *   { name: 'audit', worker: auditWorker, hooks: { on: ['create'] } },
   *   createPuckPlugin({ basePath: '/admin' }),
   * ]
   * ```
   */
  plugins?: PluginConfig[];

  /**
   * Storage configuration for file uploads.
   *
   * Storage providers are registered by plugins (e.g., S3 storage plugin).
   * This option configures which provider to use and how to route uploads.
   *
   * @example
   * ```ts
   * // All files go to S3
   * storage: 's3'
   *
   * // Dynamic routing: avatars in DB, rest to S3
   * storage: (ctx) => ctx.column === 'avatar' ? undefined : 's3'
   * ```
   */
  storage?: StorageOptions;

  /**
   * Custom Content Security Policy directives.
   * Extends the strict defaults — origins are appended, not replaced.
   *
   * @example
   * ```ts
   * // Allow S3 image previews on admin screens
   * csp: { imgSrc: ['https://my-bucket.s3.amazonaws.com'] }
   * ```
   */
  csp?: CspOptions;

  /**
   * Rate-limit hint levels (see the "Rate-limit hints" section of the
   * package README).
   *
   * The CMS never enforces rate limits — it labels each response with a
   * recommended throttle strictness (1–3) that your proxy, CDN, or wrapping
   * middleware can enforce.
   *
   * - `false` (default): no classification, no header — responses are
   *   byte-identical to hints not existing.
   * - `'in-process'`: classification readable via `getRouteInfo(response)`;
   *   nothing on the wire.
   * - `'header'`: additionally sets `X-Rate-Limit-Level: 1|2|3` on every
   *   response. Strip the header at the layer that consumes it.
   *
   * @default false
   */
  rateLimitHints?: false | 'in-process' | 'header';
}

/**
 * CMS options with authentication enabled.
 *
 * @example
 * ```ts
 * createCmsHandler({
 *   db,
 *   schema,
 *   auth: { provider: new PasswordProvider({ db, usersTable: schema.adminUsers }) },
 *   policies: {
 *     posts: ownedBy(schema.posts, 'authorId'),
 *   },
 * });
 * ```
 */
export interface CmsOptionsWithAuth extends CmsOptionsBase {
  /**
   * JWT authentication configuration.
   *
   * When provided, the CMS requires login to access.
   * Includes automatic /login and /logout routes.
   */
  auth: CmsAuthOptions;

  /**
   * Row and column-level security policies (REQUIRED).
   *
   * You must explicitly choose an authorization strategy:
   * - `policies: { table: policy, ... }` - Apply row/column policies
   * - `policies: {}` - Full access for all authenticated users
   * - `policies: 'dangerously-open'` - Bypass all policy checks
   */
  policies: Policies | 'dangerously-open';
}

/**
 * CMS options without authentication.
 * Requires explicit acknowledgment that the CMS is open to anyone.
 */
export interface CmsOptionsWithoutAuth extends CmsOptionsBase {
  /**
   * Explicit acknowledgment that the CMS is open without authentication.
   *
   * This string literal forces developers to consciously opt-in to running
   * the CMS without any authentication, preventing accidental exposure.
   *
   * @example
   * ```ts
   * createCmsHandler({
   *   db,
   *   schema,
   *   auth: 'dangerously-open',
   *   policies: 'dangerously-open', // or policiesFromSchema(schema)
   * });
   * ```
   */
  auth: 'dangerously-open';

  /**
   * Row and column-level security policies (REQUIRED).
   *
   * Even without authentication, policies are required to make
   * authorization explicit. User-based policies (ownedBy, roleIs)
   * won't work since there's no `ctx.user`, but source-based
   * column policies (from `policiesFromSchema`) still work.
   *
   * Use `'dangerously-open'` to bypass all policy checks.
   */
  policies: Policies | 'dangerously-open';
}

/**
 * Options for creating the CMS handler.
 *
 * Both `auth` and `policies` are required to make security decisions explicit:
 * - `auth`: Either `{ provider: ... }` for login, or `'dangerously-open'`
 * - `policies`: Either `{ table: policy, ... }`, `{}`, or `'dangerously-open'`
 *
 * @example
 * ```ts
 * // With authentication
 * createCmsHandler({
 *   db, schema,
 *   auth: { provider: new PasswordProvider(...) },
 *   policies: { posts: ownedBy(schema.posts, 'authorId') },
 * });
 *
 * // Without authentication (internal tool)
 * createCmsHandler({
 *   db, schema,
 *   auth: 'dangerously-open',
 *   policies: 'dangerously-open',
 * });
 * ```
 */
export type CmsOptions = CmsOptionsWithAuth | CmsOptionsWithoutAuth;

/**
 * JWT authentication options for CMS
 */
export interface CmsAuthOptions {
  /**
   * Secret for signing JWTs (32+ characters).
   *
   * If not provided, falls back to CMS_JWT_SECRET environment variable.
   * If neither is set, createCmsHandler() throws an error.
   */
  secret?: string;

  /** Auth provider for login (e.g., PasswordProvider) */
  provider: AuthProvider;

  /** Token lifetime in seconds (default: 8 hours) */
  maxAge?: number;

  /** Cookie name for JWT (default: 'cms_token') */
  cookieName?: string;

  /**
   * SameSite attribute for the auth cookie (default: 'Lax').
   *
   * - `'Lax'` mitigates CSRF while preserving top-level cross-site navigation
   *   into authed pages.
   * - `'Strict'` is the strongest CSRF posture but logs users out when they
   *   arrive via a cross-site link until they navigate same-site.
   *
   * See SECURITY.md → "Cookie SameSite & CSRF posture" for guidance.
   */
  sameSite?: SameSite;

  /** Title shown on login page (default: 'Admin Login') */
  loginTitle?: string;

  /** Label for identity field (default: 'Email') */
  identityLabel?: string;

  /**
   * Optional: Check if a token has been revoked.
   * Called on each request - implement blocklist here if needed.
   */
  isRevoked?: (payload: JwtPayload) => Promise<boolean> | boolean;
}

/**
 * Internal options after introspection
 */
export interface ResolvedCmsOptions {
  /** Introspected schema */
  introspected: IntrospectedSchema;
  /** Drizzle database instance */
  // deno-lint-ignore no-explicit-any
  db: any;
  /** Base path for CMS routes */
  basePath: string;
  /** Site title for the admin UI */
  title: string;
  /** Secret for CSRF token signing */
  csrfSecret: string;
  /** Custom authentication check */
  isAuthenticated: (request: Request) => Promise<boolean> | boolean;
  /** Error handler for unexpected errors */
  onError?: (error: Error, context: ErrorContext) => void;
  /** Custom parsers for validation */
  parsers: Parsers;
  /** Row-level security policies */
  policies: Policies;
  /** JWT auth config (resolved) - undefined if auth disabled */
  auth?: ResolvedAuthOptions;
  /** Plugin registry (undefined if no plugins configured) */
  plugins?: PluginRegistry;
  /** Storage registry (built from plugins) - undefined if no storage providers */
  storage?: StorageRegistry;
  /** Computed security headers (CSP + other headers), built once at startup */
  securityHeaders: Record<string, string>;
  /** Pre-computed route-specific security headers (plugin routes with CSP overrides) */
  routeSecurityHeaders: Map<string, Record<string, string>>;
}

/**
 * Resolved auth options with defaults applied
 */
export interface ResolvedAuthOptions {
  secret: string;
  provider: AuthProvider;
  maxAge: number;
  cookieName: string;
  sameSite: SameSite;
  loginTitle: string;
  identityLabel: string;
  isRevoked?: (payload: JwtPayload) => Promise<boolean> | boolean;
}

/**
 * Parsed route information
 */
export interface ParsedRoute {
  /** The matched table, or null for dashboard */
  table: IntrospectedTable | null;
  /** The CRUD action to perform */
  action: CrudAction | 'dashboard';
  /** Record ID for read/update/delete actions */
  recordId?: string;
}

/**
 * Flash message for user feedback
 */
export interface FlashMessage {
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

/**
 * Context passed to route handlers
 */
export interface RouteContext {
  request: Request;
  options: ResolvedCmsOptions;
  route: ParsedRoute;
  url: URL;
  /**
   * Flash messages to render at the top of the page.
   *
   * Populated by the dispatcher from `?_flash=...` URL params and
   * extended/replaced by the `resolveFlashes` UI plugin hook.
   */
  flashes?: FlashMessage[];
  /** Authenticated user info (when auth is enabled) */
  authUser?: { id: string; identity?: string; role?: string };
  /** Plugin service for executing hooks (when plugins configured) */
  pluginService?: PluginService;
}
