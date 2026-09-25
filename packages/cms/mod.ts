// @hotsauce/cms
// CRUD route handlers using Web Standard Request/Response
// Works with Deno, Node 20+, Bun, Cloudflare Workers

import { eq, sql, type Table } from 'drizzle-orm';

import type {
  CmsOptions,
  CrudAction,
  CspOptions,
  FlashMessage,
  Handler,
  ResolvedAuthOptions,
  ResolvedCmsOptions,
  RouteContext,
  StorageId,
  StorageOptions,
  StorageProvider,
  StorageRegistry,
} from './types.ts';
import type { Policies } from './policies/types.ts';
import {
  introspectFullSchema,
  isValidFileKey,
  isValidFileReference,
  mapColumnToFieldType,
} from '@hotsauce/core';
import { matchPluginRoute, parseRoute, resolveAction } from './router.ts';
import {
  classifyCmsRequest,
  RATE_LIMIT_LEVEL_HEADER,
  registerRateLimitHintsMode,
  storeRouteInfo,
} from './rate-limit-hints.ts';
import type { PluginRouteMatch } from './router.ts';
import type {
  FilterContext,
  PluginRouteContext,
  Serializable,
} from './plugins/types.ts';
import {
  base64ToUint8Array,
  buildSecurityHeaders,
  capStream,
  contentDispositionHeader,
  forbidden,
  methodNotAllowed,
  notFound,
  parseFlashFromUrl,
  readBodyWithLimit,
} from './http.ts';
import {
  generateCsrfToken,
  getCsrfTokenFromHeader,
  validateCsrfToken,
} from './csrf.ts';
import {
  CmsConfigError,
  validateAutoDraft,
  validateCmsOptions,
  validateCspOptions,
  validateFileColumnsAndConfigs,
  validateResolvedSecrets,
  validateThumbnailColumns,
} from './validation.ts';
import { getEnv } from './runtime-compat.ts';
import { createPluginRegistry } from './plugins/registry.ts';
import { createPluginService } from './plugins/service.ts';
import type { PluginErrorHandler } from './plugins/service.ts';
import {
  handleCreate,
  handleDashboard,
  handleDelete,
  handleList,
  handleRead,
  handleUpdate,
} from './crud.ts';
import { handleStylesheet } from './styles.ts';
import { handlePickerScript, handleScript } from './scripts.ts';

// Auth imports from @hotsauce/auth
import {
  type AccountRouteContext,
  createAuthCookie,
  createClearCookie,
  createJwtPayload,
  getTokenFromCookies,
  handle2FADisable,
  handle2FAEnable,
  handle2FASetupForm,
  handleAccountPage,
  handlePasswordChange,
  handlePasswordChangeForm,
  isSecureRequest,
  type JwtPayload,
  type PasswordProvider,
  renderLoginPage,
  signJwt,
  verifyJwt,
} from '@hotsauce/auth';

import {
  applyPolicy,
  createPolicyContext,
  evaluateColumnPolicies,
  extractColumnPolicies,
  extractRowPolicy,
  filterRecordColumns,
  findRecordWithPolicy,
  recordExists,
} from './policies/mod.ts';

// ─────────────────────────────────────────────────────────────
// Types - Handler configuration and request context
// ─────────────────────────────────────────────────────────────
export type {
  CmsAuthOptions,
  CmsOptions,
  CmsOptionsBase,
  CmsOptionsWithAuth,
  CmsOptionsWithoutAuth,
  CrudAction,
  CspOptions,
  DeleteContext,
  ErrorContext,
  FlashMessage,
  Handler,
  ParsedRoute,
  ParserFn,
  Parsers,
  PresignContext,
  PresignResult,
  ResolveStorageContext,
  ResolveStorageFn,
  RouteContext,
  SignDownloadContext,
  StorageId,
  StorageOptions,
  StorageProvider,
  StorageRegistry,
  TableParsers,
} from './types.ts';

// ─────────────────────────────────────────────────────────────
// Validation - Configuration validation (throws on invalid)
// ─────────────────────────────────────────────────────────────
export {
  CmsConfigError,
  CmsOptionsSchema,
  ResolvedSecretsSchema,
  validateAutoDraft,
  validateCmsOptions,
  validateFileColumnsAndConfigs,
  validateResolvedSecrets,
  validateThumbnailColumns,
} from './validation.ts';

// ─────────────────────────────────────────────────────────────
// Form Validation - Zod-based form data validation
// ─────────────────────────────────────────────────────────────
export type { ValidationResult } from './crud-helpers.ts';
export {
  formatZodErrors,
  validateFormData,
  validateWithParsers,
} from './crud-helpers.ts';

// ─────────────────────────────────────────────────────────────
// CSRF - Token generation and validation
// ─────────────────────────────────────────────────────────────
export {
  generateCsrfToken,
  getCsrfFieldName,
  getCsrfTokenFromFormData,
  getCsrfTokenFromHeader,
  validateCsrfToken,
} from './csrf.ts';

// ─────────────────────────────────────────────────────────────
// Source Tokens - Identify CMS vs plugin form submissions
// ─────────────────────────────────────────────────────────────
export {
  generateSourceToken,
  getPluginName,
  getSourceTokenFromFormData,
  isPluginSource,
  pluginSource,
  SOURCE,
  SOURCE_FIELD_NAME,
  validateSourceToken,
} from './tokens/mod.ts';

// Import locally for use in handlePluginRoute
import {
  generateSourceToken,
  pluginSource,
  validateSourceToken,
} from './tokens/mod.ts';

// ─────────────────────────────────────────────────────────────
// Router - URL parsing and route generation
// ─────────────────────────────────────────────────────────────
export {
  cmsUrl,
  formatColumnName,
  formatTableName,
  generateNavLinks,
  matchPattern,
  matchPluginRoute,
  parseRoute,
  resolveAction,
} from './router.ts';
export type { PluginRouteMatch } from './router.ts';

// ─────────────────────────────────────────────────────────────
// Utils - Response helpers and form parsing
// ─────────────────────────────────────────────────────────────
export type {
  FlashCode,
  JsonCrudAction,
  JsonCrudResponse,
  JsonErrorResponse,
  JsonSuccessResponse,
  JsonValidationErrorResponse,
  ParsedMultipartData,
} from './http.ts';

export {
  base64ToUint8Array,
  buildUrl,
  coerceFormValues,
  coerceValue,
  contentDispositionHeader,
  forbidden,
  getPagination,
  getSort,
  htmlResponse,
  jsonError,
  jsonResponse,
  jsonSuccess,
  jsonValidationError,
  matchesAcceptPattern,
  methodNotAllowed,
  notFound,
  parseFlashFromUrl,
  parseFormData,
  parseMultipartFormData,
  redirect,
  redirectWithFlash,
  wantsJson,
} from './http.ts';

// ─────────────────────────────────────────────────────────────
// Runtime - Cross-runtime utilities
// ─────────────────────────────────────────────────────────────
export { getEnv, requireEnv } from './runtime-compat.ts';

// ─────────────────────────────────────────────────────────────
// Styles - CSS stylesheet served as external file
// ─────────────────────────────────────────────────────────────
export { cmsStylesheet, cssResponse, handleStylesheet } from './styles.ts';

// ─────────────────────────────────────────────────────────────
// Scripts - JavaScript served as external file
// ─────────────────────────────────────────────────────────────
export {
  cmsScript,
  handlePickerScript,
  handleScript,
  jsResponse,
  pickerScript,
} from './scripts.ts';

// ─────────────────────────────────────────────────────────────
// Policies - Row-level security for fine-grained authorization
// ─────────────────────────────────────────────────────────────
export type {
  ActionPolicies,
  Policies,
  Policy,
  PolicyApplicationResult,
  PolicyContext,
  PolicyFn,
  PolicyResult,
} from './policies/mod.ts';

export {
  adminOr,
  allOf,
  // Core helpers
  always,
  // Combining
  anyOf,
  // Application utilities
  applyPolicy,
  authenticated,
  createPolicyContext,
  // Action-specific
  forActions,
  // Schema-based policies
  getColumnPluginSources,
  never,
  // Ownership
  ownedBy,
  ownedByOrContributor,
  policiesFromSchema,
  readOnly,
  roleIn,
  // Role-based
  roleIs,
} from './policies/mod.ts';

// ─────────────────────────────────────────────────────────────
// Plugins - Extensibility with Worker isolation
// ─────────────────────────────────────────────────────────────
export type {
  ActionContext,
  ActionHandlerFn,
  ActionHook,
  FieldUIOverride,
  FilterContext,
  // Filter types
  HookType,
  InProcessPluginConfig,
  PluginCapabilities,
  PluginConfig,
  PluginContext,
  PluginFilter,
  PluginHooks,
  // Route types
  PluginRoute,
  PluginRouteContext,
  PluginRouteHandler,
  Serializable,
  TransformFn,
  UIFieldInfo,
  UIHooks,
  UIRenderFieldContext,
  UIRenderFieldFn,
  WorkerPluginConfig,
} from './plugins/types.ts';

export { isWorkerPlugin } from './plugins/types.ts';

// ─────────────────────────────────────────────────────────────
// Rate-limit hints — route classification (README: "Rate-limit hints")
// ─────────────────────────────────────────────────────────────
export {
  deriveRateLimitLevel,
  getRouteInfo,
  RATE_LIMIT_LEVEL_HEADER,
} from './rate-limit-hints.ts';
export type {
  RateLimitLevel,
  RouteFacts,
  RouteInfo,
} from './rate-limit-hints.ts';

// ─────────────────────────────────────────────────────────────
// Auth - JWT authentication (re-exported from @hotsauce/auth)
// ─────────────────────────────────────────────────────────────
export type {
  AccountRouteContext,
  AccountRouteContextWith2FA,
  AuthProvider,
  AuthResult,
  AuthUser,
  JwtPayload,
  PasswordCredentials,
  PasswordProviderOptions,
  TwoFactorCredentials,
} from '@hotsauce/auth';

export {
  accountStyles,
  createAuthCookie,
  createChallengeToken,
  createClearCookie,
  createJwtPayload,
  // TOTP utilities
  generateTOTP,
  generateTOTPSecret,
  generateTOTPUri,
  // Cookie utilities
  getTokenFromCookies,
  handle2FADisable,
  handle2FAEnable,
  handle2FASetupForm,
  handleAccountPage,
  handlePasswordChange,
  handlePasswordChangeForm,
  // Type guard for 2FA context
  has2FAEnabled,
  // Password hashing
  hashPassword,
  isSecureRequest,
  loginStyles,
  // Auth providers
  PasswordProvider,
  render2FADisablePage,
  render2FASetupPage,
  renderAccountPage,
  renderLoginPage,
  renderPasswordChangePage,
  // JWT utilities
  signJwt,
  twoFactorStyles,
  verifyChallengeToken,
  verifyJwt,
  verifyPassword,
  verifyTOTP,
} from '@hotsauce/auth';

/**
 * Create a CMS handler function
 *
 * Returns a Web Standard Request → Response handler that can be used with:
 * - Deno.serve()
 * - Node.js 18+ with adapters
 * - Hono, Express, Oak, etc.
 * - Cloudflare Workers, Vercel Edge
 *
 * @example
 * ```ts
 * import { createCmsHandler } from '@hotsauce/cms';
 * import * as schema from './schema.ts';
 *
 * const handler = createCmsHandler({
 *   db,
 *   schema,
 *   basePath: '/admin',
 * });
 *
 * Deno.serve(handler);
 * ```
 *
 * @example With authentication
 * ```ts
 * import { createCmsHandler, PasswordProvider } from '@hotsauce/cms';
 *
 * const handler = createCmsHandler({
 *   db,
 *   schema,
 *   basePath: '/admin',
 *   auth: {
 *     secret: process.env.JWT_SECRET!,
 *     provider: new PasswordProvider({
 *       db,
 *       usersTable: schema.adminUsers,
 *       identityField: 'email',
 *       passwordField: 'passwordHash',
 *     }),
 *   },
 * });
 * ```
 */

// Import the CmsGlobalThis interface from workers for type-safe globalThis access
import type { CmsGlobalThis } from '@hotsauce/workers';
import type { PluginService } from './plugins/service.ts';

// ─────────────────────────────────────────────────────────────
// Plugin route handling
// ─────────────────────────────────────────────────────────────

/**
 * Default request body cap for plugin routes (200KB) — generous for the JSON
 * payloads plugin routes typically handle. Overridable per route via
 * `maxBodySize`. Shared by the handler's body read and the dispatch-level CSRF
 * size gate so both enforce the same limit.
 */
const DEFAULT_PLUGIN_ROUTE_MAX_BODY = 204_800;

/**
 * Handle a plugin route.
 * Builds context, fetches record data, then calls handler or Worker.
 */
async function handlePluginRoute(
  match: PluginRouteMatch,
  request: Request,
  options: ResolvedCmsOptions,
  jwtPayload: JwtPayload | null,
  pluginService: PluginService | null,
): Promise<Response> {
  const { plugin, route, params } = match;

  // Infer route action from method for policy and filter checks.
  const routeAction = inferPluginRouteAction(request.method);

  // Extract table and recordId from params (common pattern)
  const table = params.table;
  const recordId = params.id;
  const column = params.column;

  // ─────────────────────────────────────────────────────────────
  // SECURITY: Check plugin filter BEFORE fetching any data
  // This prevents data exfiltration via routes even when the
  // integrator has filtered out certain tables/actions.
  // ─────────────────────────────────────────────────────────────
  const pluginFilter = plugin.filter;

  const filterCtx: FilterContext = {
    hookType: 'route',
    table: table ?? '',
    action: routeAction,
    user: jwtPayload
      ? { sub: jwtPayload.sub, role: jwtPayload.role }
      : undefined,
  };

  // Check filter - plugins with routes MUST have filter (validated at registration)
  // If filter is 'dangerously-open', skip check; otherwise evaluate the function
  if (pluginFilter !== 'dangerously-open') {
    // Filter is guaranteed to be a function here (not undefined)
    const allowed = (pluginFilter as (ctx: FilterContext) => boolean)(
      filterCtx,
    );
    if (!allowed) {
      return new Response('Plugin route not allowed for this table', {
        status: 403,
      });
    }
  }

  // Get CSRF token for forms
  const csrfSecret = options.csrfSecret;
  const csrfToken = await generateCsrfToken(csrfSecret);

  // Generate source token for this plugin
  const sourceToken = await generateSourceToken(
    pluginSource(plugin.name),
    csrfSecret,
  );

  // Body is read lazily after validation to avoid processing large payloads
  // for requests that will be rejected anyway (invalid table, record, or policy)
  let body: string | undefined;
  let bodyStream: ReadableStream<Uint8Array> | undefined;

  // Build base context (without record data)
  const baseCtx: Omit<PluginRouteContext, 'record' | 'value' | 'field'> = {
    table: table ?? '',
    recordId: recordId ?? '',
    column,
    user: jwtPayload
      ? {
        sub: jwtPayload.sub,
        role: jwtPayload.role,
      }
      : undefined,
    csrfToken,
    sourceToken,
    basePath: options.basePath,
    requestUrl: request.url,
    method: request.method,
    contentType: request.headers.get('content-type') ?? undefined,
    body,
    bodyStream,
    params,
  };

  // Fetch record data if table and recordId are provided
  // IMPORTANT: Apply row policies (filter which records user can access)
  // and column policies (filter which fields user can see) to prevent data leaks
  let record: Record<string, Serializable> = {};
  let value: Serializable = undefined;
  let field: PluginRouteContext['field'] = undefined;

  if (table && recordId) {
    // Find the table in schema
    const tableInfo = options.introspected.tables.find((t) => t.name === table);
    if (!tableInfo) {
      return new Response('Table not found', { status: 404 });
    }

    // Get the Drizzle table object from introspected table
    const drizzleTable = tableInfo.table as Table | undefined;
    if (!drizzleTable) {
      return new Response('Table not found', { status: 404 });
    }

    // Build policy context for row and column policy evaluation
    const policyCtx = createPolicyContext(
      request,
      jwtPayload ? { id: jwtPayload.sub, role: jwtPayload.role } : undefined,
    );

    // Get table policy (may have row and/or column policies)
    const tablePolicy = options.policies?.[table];

    // Apply ROW policy - determines if user can access this specific record
    // Action derived from HTTP method: GET=read, POST=update
    const rowPolicy = extractRowPolicy(tablePolicy);
    const policyResult = await applyPolicy(rowPolicy, policyCtx, routeAction);

    if (!policyResult.allowed) {
      return new Response('Access denied', { status: 403 });
    }

    // Fetch record WITH row policy condition applied
    const rawRecord = await findRecordWithPolicy(
      options.db,
      drizzleTable,
      tableInfo,
      recordId,
      policyResult.condition,
    );

    if (!rawRecord) {
      // Check if record exists at all (to distinguish 404 vs 403)
      const exists = await recordExists(
        options.db,
        drizzleTable,
        tableInfo,
        recordId,
      );
      if (exists) {
        // Record exists but policy filtered it out
        return new Response('Access denied', { status: 403 });
      }
      return new Response('Record not found', { status: 404 });
    }

    // Apply COLUMN policies - filter which fields the user can see
    const columnPolicies = extractColumnPolicies(tablePolicy);
    const columnResult = await evaluateColumnPolicies(
      columnPolicies,
      tableInfo.columns,
      policyCtx,
    );

    // Filter record to only include readable columns
    record = filterRecordColumns(
      rawRecord,
      columnResult.readableColumns,
      tableInfo.columns,
    ) as Record<string, Serializable>;

    // Extract column value and field info (from FILTERED record)
    if (column) {
      const columnInfo = tableInfo.columns.find((c) => c.name === column);
      if (columnInfo) {
        // For mutating actions, check write permission; for reads, check read permission
        const isWrite = routeAction === 'update' || routeAction === 'delete';
        const allowedColumns = isWrite
          ? columnResult.writableColumns
          : columnResult.readableColumns;

        if (allowedColumns.includes(column)) {
          value = record[columnInfo.propertyName] as Serializable;
          field = {
            name: columnInfo.name,
            type: mapColumnToFieldType(columnInfo),
            config: (columnInfo.cmsOptions ?? {}) as Record<
              string,
              Serializable
            >,
          };
        } else {
          // Column exists but user doesn't have access
          return new Response('Column not accessible', { status: 403 });
        }
      }
    }
  }

  // Read request body for mutating requests (deferred until after validation)
  if (routeAction === 'update' || routeAction === 'delete') {
    // Cap the request body size (defence-in-depth; routes are auth + CSRF gated).
    // Default to 200KB — generous for the JSON payloads plugin routes handle.
    // Streams the body and aborts mid-transfer once the cap is exceeded, so an
    // oversized chunked body (no Content-Length) is never fully buffered.
    const maxBody = route.maxBodySize ?? DEFAULT_PLUGIN_ROUTE_MAX_BODY;
    if (route.bodyType === 'stream' && route.handler) {
      // Stream routes (in-process only) get the raw bytes without a text
      // round-trip — the body never lands in `ctx.body` as a string. The cap
      // is enforced lazily by erroring the stream mid-transfer; an oversized
      // Content-Length is still rejected up front here.
      const result = capStream(request, maxBody);
      if (result.tooLarge) {
        return new Response('Request body too large', { status: 413 });
      }
      bodyStream = result.stream ?? undefined;
    } else {
      const result = await readBodyWithLimit(request, maxBody);
      if (result.tooLarge) {
        return new Response('Request body too large', { status: 413 });
      }
      body = result.body;
    }
  }

  // Build full context
  const ctx: PluginRouteContext = {
    ...baseCtx,
    record,
    value,
    field,
    body, // Add body to context (overrides undefined from baseCtx)
    bodyStream, // Raw byte stream for `bodyType: 'stream'` routes
  };

  // Use route-specific headers if plugin route has CSP overrides
  const methods = [...(route.methods ?? ['GET'])].sort().join(',');
  const routeKey = `${plugin.name}/${route.pattern}/${methods}`;
  const effectiveHeaders = options.routeSecurityHeaders.get(routeKey) ??
    options.securityHeaders;

  // Dispatch based on route type. Dispatch owns bodyStream cleanup: once the
  // handler settles, an unconsumed capped stream is cancelled below so the
  // client transfer is aborted (handlers used to do this themselves).
  try {
    if (route.handler) {
      // In-process handler
      const result = await route.handler(ctx);
      if (result instanceof Response) {
        const ct = result.headers.get('content-type') ?? '';
        const applySecurityHeaders = (res: Response): Response => {
          if (ct.startsWith('text/html')) {
            // Enforce all security headers for HTML responses
            // (plugins cannot override CSP, X-Frame-Options, etc.)
            for (const [k, v] of Object.entries(effectiveHeaders)) {
              res.headers.set(k, v);
            }
          } else {
            // Non-HTML: enforce nosniff (prevents MIME-sniffing of CSS/JS/JSON)
            res.headers.set('X-Content-Type-Options', 'nosniff');
          }
          return res;
        };
        try {
          return applySecurityHeaders(result);
        } catch {
          // Immutable headers (Response.redirect(), a proxied fetch()):
          // rebuild so the security headers are still enforced.
          return applySecurityHeaders(new Response(result.body, result));
        }
      }
      // String result - wrap in HTML response with security headers
      return new Response(result, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...effectiveHeaders,
        },
      });
    }

    if (route.render && pluginService) {
      // Worker render - use executor
      const html = await pluginService.executeRouteRender(
        plugin.name,
        route.render,
        ctx,
      );
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...effectiveHeaders,
        },
      });
    }

    // No handler or render configured (should be caught by validation)
    return new Response('Route not configured', { status: 500 });
  } catch (error) {
    // Generate request ID to correlate error logs with user-facing response
    const requestId = crypto.randomUUID();
    options.onError?.(error as Error, {
      source: 'handler',
      request,
      url: new URL(request.url),
      route: null, // Plugin routes don't use ParsedRoute
      action: routeAction,
      requestId,
      plugin: plugin.name,
    });
    return new Response(`Plugin error (request: ${requestId})`, {
      status: 500,
    });
  } finally {
    // A handler that consumed the body via getReader()/pipeTo() holds the
    // stream's lock; a fully-drained, closed stream is unlocked but cancel()
    // is then a resolved no-op. NOTE: new Response(bodyStream) does NOT lock
    // the stream until serialization, so returning the raw stream as a
    // response body is unsupported (it would be cancelled here) — see the
    // bodyStream contract in workers/types.ts. Swallow rejections — an
    // unhandled rejection is fatal on Node.
    if (bodyStream && !bodyStream.locked) {
      bodyStream.cancel().catch(() => {});
    }
  }
}

/**
 * Infer the required authorization action for plugin routes from HTTP method.
 * Mutating methods require write-level access by default.
 */
function inferPluginRouteAction(method: string): CrudAction {
  switch (method.toUpperCase()) {
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    case 'GET':
    case 'HEAD':
      return 'read';
    default:
      return 'read';
  }
}

// ─────────────────────────────────────────────────────────────
// Storage provider extraction
// ─────────────────────────────────────────────────────────────

/**
 * Extract storage providers from in-process plugins and build a registry.
 * Only in-process plugins can provide storage providers (Worker plugins cannot).
 *
 * @param plugins - Plugin configurations to scan
 * @param storageOptions - User-provided storage configuration
 * @returns Storage registry or undefined if no providers
 */
function buildStorageRegistry(
  plugins: import('./plugins/types.ts').PluginConfig[] | undefined,
  storageOptions: StorageOptions | undefined,
): StorageRegistry | undefined {
  const instances = new Map<StorageId, StorageProvider>();

  // Extract providers from plugins
  if (plugins) {
    for (const plugin of plugins) {
      // Only in-process plugins can have storageProvider
      if (!plugin.worker) {
        const inProcessPlugin =
          plugin as import('./plugins/types.ts').InProcessPluginConfig;
        if (inProcessPlugin.storageProvider) {
          const provider = inProcessPlugin.storageProvider;

          // Check for duplicate IDs
          if (instances.has(provider.id)) {
            throw new Error(
              `Storage provider "${provider.id}" already registered. ` +
                `Plugin "${plugin.name}" conflicts with an existing provider.`,
            );
          }

          instances.set(provider.id, provider);
        }
      }
    }
  }

  // If no providers extracted and no storage options, return undefined
  if (instances.size === 0 && !storageOptions) {
    return undefined;
  }

  // Normalize storage options into registry format
  // - string: all files go to that provider
  // - function: dynamic routing
  let defaultObjectStorageId: StorageId | undefined;
  let resolveStorage: import('./types.ts').ResolveStorageFn | undefined;

  if (typeof storageOptions === 'string') {
    defaultObjectStorageId = storageOptions;
  } else if (typeof storageOptions === 'function') {
    resolveStorage = storageOptions;
  }

  // Build registry with normalized options
  const registry: StorageRegistry = {
    instances,
    defaultObjectStorageId,
    resolveStorage,
  };

  // If defaultObjectStorageId is set, validate it exists
  if (
    registry.defaultObjectStorageId &&
    !instances.has(registry.defaultObjectStorageId)
  ) {
    throw new Error(
      `Invalid storage configuration: defaultObjectStorageId "${registry.defaultObjectStorageId}" ` +
        `does not match any registered storage provider. ` +
        `Available providers: ${[...instances.keys()].join(', ') || '(none)'}`,
    );
  }

  return registry;
}

export function createCmsHandler(options: CmsOptions): Handler {
  // Mark the main thread - Workers won't have this set
  (globalThis as CmsGlobalThis).__CMS_MAIN_PROCESS__ = true;

  // Validate configuration (throws CmsConfigError on invalid)
  validateCmsOptions(options);

  // Check if using real auth or running dangerously open
  const hasRealAuth = options.auth !== 'dangerously-open';

  // Resolve secrets from options or environment variables, then validate
  const unresolvedAuthSecret = hasRealAuth
    ? (options.auth.secret || getEnv('CMS_JWT_SECRET'))
    : undefined;
  const unresolvedCsrfSecret = options.csrfSecret || getEnv('CMS_CSRF_SECRET');

  // Validate resolved secrets (after env var fallback) - returns typed values
  const { csrfSecret, authSecret: resolvedAuthSecret } =
    validateResolvedSecrets({
      csrfSecret: unresolvedCsrfSecret,
      authSecret: unresolvedAuthSecret,
    });

  // Introspect schema if needed (check if it's already introspected)
  const isAlreadyIntrospected = 'tables' in options.schema &&
    Array.isArray(options.schema.tables);
  const introspected = isAlreadyIntrospected
    ? options
      .schema as unknown as import('@hotsauce/core').IntrospectedSchema
    : introspectFullSchema(options.schema);

  // Validate file column configurations (file: true must be on JSON columns)
  validateFileColumnsAndConfigs(introspected);

  // Validate thumbnail columns (at most one per table)
  validateThumbnailColumns(introspected);

  // Validate autoDraft tables (all non-PK columns must have defaults or be nullable)
  validateAutoDraft(introspected);

  // Validate and build CSP security headers (computed once at startup)
  if (options.csp) {
    validateCspOptions(options.csp);
  }
  const securityHeaders = buildSecurityHeaders(options.csp);

  // Pre-compute route-specific security headers for plugin routes with CSP overrides.
  // Each route's CSP is merged with (and extends) the global CSP.
  const routeSecurityHeaders = new Map<string, Record<string, string>>();

  // Resolve policies:
  // - 'dangerously-open' → {} (full access)
  // - object → use as-is
  const resolvedPolicies: Policies = options.policies === 'dangerously-open'
    ? {}
    : options.policies;

  // Resolve auth options if provided
  const resolvedAuth: ResolvedAuthOptions | undefined = hasRealAuth
    ? {
      secret: resolvedAuthSecret!,
      provider: options.auth.provider,
      maxAge: options.auth.maxAge ?? 8 * 60 * 60, // 8 hours
      cookieName: options.auth.cookieName ?? 'cms_token',
      sameSite: options.auth.sameSite ?? 'Lax',
      loginTitle: options.auth.loginTitle ?? 'Admin Login',
      identityLabel: options.auth.identityLabel ?? 'Email',
      isRevoked: options.auth.isRevoked,
    }
    : undefined;

  // Initialize plugin registry if plugins are configured
  const pluginRegistry = options.plugins && options.plugins.length > 0
    ? createPluginRegistry(options.plugins)
    : undefined;

  // Create plugin service (lazy initialization - Workers start on first use)
  // Plugin errors flow through two paths:
  // 1. Blocking/in-process: error propagates to CRUD handler's catch → options.onError with source: 'handler'
  // 2. Fire-and-forget: error caught by WorkerExecutor → this bridge forwards to options.onError with source: 'plugin'
  const pluginOnError: PluginErrorHandler = (error, ctx) => {
    if (options.onError) {
      options.onError(error, ctx);
    } else {
      // deno-lint-ignore no-console
      console.error(
        `[CMS Plugin Error] ${ctx.plugin}/${ctx.operation}:`,
        error.message,
      );
    }
  };
  const pluginService = createPluginService(pluginRegistry, pluginOnError);

  // Build storage registry from plugins and options
  const storageRegistry = buildStorageRegistry(
    options.plugins,
    options.storage,
  );

  // Validate and pre-compute route-specific CSP headers
  if (pluginRegistry) {
    const ALLOWED_ROUTE_CSP_KEYS = new Set(['styleSrc', 'connectSrc']);
    for (const { pluginName, route } of pluginRegistry.getAllRoutes()) {
      if (route.csp) {
        const unknownKeys = Object.keys(route.csp).filter(
          (k) => !ALLOWED_ROUTE_CSP_KEYS.has(k),
        );
        if (unknownKeys.length > 0) {
          throw new CmsConfigError(
            `Plugin '${pluginName}' route '${route.pattern}' has unsupported csp keys: ${
              unknownKeys.join(', ')
            }. ` +
              `Only ${
                [...ALLOWED_ROUTE_CSP_KEYS].join(', ')
              } are allowed in route-level CSP.`,
          );
        }
        validateCspOptions(route.csp);
        const mergedCsp: CspOptions = { ...options.csp };
        for (
          const key of Object.keys(route.csp) as ('styleSrc' | 'connectSrc')[]
        ) {
          const routeValues = route.csp[key];
          if (!routeValues?.length) continue;
          const global = mergedCsp[key];
          mergedCsp[key] = global?.length
            ? [...global, ...routeValues]
            : [...routeValues];
        }
        const methods = [...(route.methods ?? ['GET'])].sort().join(',');
        routeSecurityHeaders.set(
          `${pluginName}/${route.pattern}/${methods}`,
          buildSecurityHeaders(mergedCsp),
        );
      }
    }
  }

  // Apply defaults
  const opts: ResolvedCmsOptions = {
    introspected,
    db: options.db,
    basePath: (options.basePath ?? '/admin').replace(/\/+$/, ''),
    title: options.title ?? 'CMS Admin',
    csrfSecret,
    isAuthenticated: options.isAuthenticated ?? (() => true),
    onError: options.onError,
    parsers: options.parsers ?? {},
    policies: resolvedPolicies,
    auth: resolvedAuth,
    plugins: pluginRegistry,
    storage: storageRegistry,
    securityHeaders,
    routeSecurityHeaders,
  };

  // Helper to check if request accepts JSON
  const wantsJson = (request: Request): boolean => {
    const accept = request.headers.get('Accept') ?? '';
    return accept.includes('application/json');
  };

  // Rate-limit hints (README: "Rate-limit hints"). Registered even when
  // disabled so getRouteInfo() can warn about querying a disabled handler.
  const rateLimitHints = options.rateLimitHints ?? false;
  registerRateLimitHintsMode(rateLimitHints !== false);

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // JWT payload for authenticated user (set when auth is enabled)
    let jwtPayload: JwtPayload | null = null;

    // Serve stylesheet at {basePath}/styles.css
    if (
      pathname === `${opts.basePath}/styles.css` && request.method === 'GET'
    ) {
      return handleStylesheet();
    }

    // Serve script at {basePath}/admin.js
    if (
      pathname === `${opts.basePath}/admin.js` && request.method === 'GET'
    ) {
      return handleScript();
    }

    // Serve picker script at {basePath}/picker.js
    if (
      pathname === `${opts.basePath}/picker.js` && request.method === 'GET'
    ) {
      return handlePickerScript();
    }

    // ─────────────────────────────────────────────────────────────
    // Auth routes (when auth is configured)
    // ─────────────────────────────────────────────────────────────
    if (resolvedAuth) {
      const loginPath = `${opts.basePath}/login`;
      const logoutPath = `${opts.basePath}/logout`;

      // Handle logout (POST only to prevent CSRF)
      if (pathname === logoutPath && request.method === 'POST') {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': loginPath,
            'Set-Cookie': createClearCookie(
              resolvedAuth.cookieName,
              opts.basePath,
              isSecureRequest(request),
              resolvedAuth.sameSite,
            ),
            ...opts.securityHeaders,
          },
        });
      }

      // Handle login page (GET)
      if (pathname === loginPath && request.method === 'GET') {
        // If already logged in, redirect to dashboard
        const existingToken = getTokenFromCookies(
          request,
          resolvedAuth.cookieName,
        );
        if (existingToken) {
          const existingPayload = await verifyJwt(
            existingToken,
            resolvedAuth.secret,
          );
          // Check if not revoked
          let isRevoked = false;
          if (existingPayload && resolvedAuth.isRevoked) {
            isRevoked = await resolvedAuth.isRevoked(existingPayload);
          }
          if (existingPayload && !isRevoked) {
            return new Response(null, {
              status: 302,
              headers: {
                'Location': opts.basePath,
                ...opts.securityHeaders,
              },
            });
          }
        }

        const csrfToken = await generateCsrfToken(csrfSecret);
        const html = renderLoginPage({
          basePath: opts.basePath,
          title: resolvedAuth.loginTitle,
          identityLabel: resolvedAuth.identityLabel,
          csrfToken,
        });
        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...opts.securityHeaders,
          },
        });
      }

      // Handle login submission (POST)
      if (pathname === loginPath && request.method === 'POST') {
        try {
          const formData = await request.formData();

          // Validate CSRF token
          const csrfToken = formData.get('__cms_csrf') as string | null;
          const identity = formData.get('identity') as string | null;
          if (!await validateCsrfToken(csrfToken, csrfSecret)) {
            const newCsrfToken = await generateCsrfToken(csrfSecret);
            const html = renderLoginPage({
              basePath: opts.basePath,
              title: resolvedAuth.loginTitle,
              identityLabel: resolvedAuth.identityLabel,
              identityValue: identity ?? '',
              csrfToken: newCsrfToken,
              error: 'Your session has expired. Please try again.',
            });
            return new Response(html, {
              status: 403,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...opts.securityHeaders,
              },
            });
          }

          // Check if this is a TOTP verification (phase 2 of 2FA)
          const totpCode = formData.get('totp_code') as string | null;
          const challengeToken = formData.get('challenge_token') as
            | string
            | null;

          if (totpCode && challengeToken) {
            // Phase 2: Verify TOTP code with signed challenge
            const result = await resolvedAuth.provider.authenticate({
              totpCode: totpCode.replace(/\s/g, ''),
              challengeToken,
            });

            if (!result || result.status !== 'authenticated') {
              // Invalid TOTP or expired challenge - show TOTP form again with error
              // Note: We don't have the original challenge anymore, so user must re-enter password
              const newCsrfToken = await generateCsrfToken(csrfSecret);
              const html = renderLoginPage({
                basePath: opts.basePath,
                title: resolvedAuth.loginTitle,
                identityLabel: resolvedAuth.identityLabel,
                csrfToken: newCsrfToken,
                error:
                  'Invalid or expired verification code. Please log in again.',
              });
              return new Response(html, {
                status: 401,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  ...opts.securityHeaders,
                },
              });
            }

            // TOTP verified - create JWT and set cookie
            const payload = createJwtPayload(
              result.user.id,
              result.user.identity,
              result.user.role,
              resolvedAuth.maxAge,
            );
            const token = await signJwt(payload, resolvedAuth.secret);
            const cookie = createAuthCookie(
              resolvedAuth.cookieName,
              token,
              resolvedAuth.maxAge,
              opts.basePath,
              isSecureRequest(request),
              resolvedAuth.sameSite,
            );

            return new Response(null, {
              status: 302,
              headers: {
                'Location': opts.basePath,
                'Set-Cookie': cookie,
                ...opts.securityHeaders,
              },
            });
          }

          // Phase 1: Parse credentials from form data
          const password = formData.get('password') as string | null;

          // Validate required fields
          if (!identity || !password) {
            const newCsrfToken = await generateCsrfToken(csrfSecret);
            const html = renderLoginPage({
              basePath: opts.basePath,
              title: resolvedAuth.loginTitle,
              identityLabel: resolvedAuth.identityLabel,
              identityValue: identity ?? '',
              csrfToken: newCsrfToken,
              error: 'Please enter your email and password.',
            });
            return new Response(html, {
              status: 400,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...opts.securityHeaders,
              },
            });
          }

          // Authenticate
          const result = await resolvedAuth.provider.authenticate({
            identity,
            password,
          });

          if (!result) {
            const newCsrfToken = await generateCsrfToken(csrfSecret);
            const html = renderLoginPage({
              basePath: opts.basePath,
              title: resolvedAuth.loginTitle,
              identityLabel: resolvedAuth.identityLabel,
              identityValue: identity ?? '',
              csrfToken: newCsrfToken,
              error: 'Invalid email or password.',
            });
            return new Response(html, {
              status: 401,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...opts.securityHeaders,
              },
            });
          }

          // Check if 2FA verification is needed
          if (result.status === 'pending_2fa') {
            const provider = resolvedAuth.provider as {
              renderTotpForm?: (options: {
                basePath: string;
                title: string;
                error?: string;
                challengeToken: string;
                csrfToken: string;
              }) => string;
            };

            if (provider.renderTotpForm) {
              const newCsrfToken = await generateCsrfToken(csrfSecret);
              const html = provider.renderTotpForm({
                basePath: opts.basePath,
                title: resolvedAuth.loginTitle,
                challengeToken: result.challenge,
                csrfToken: newCsrfToken,
              });
              return new Response(html, {
                status: 200,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  ...opts.securityHeaders,
                },
              });
            }
            // Provider doesn't support 2FA form - treat as auth failure
            const newCsrfToken = await generateCsrfToken(csrfSecret);
            const html = renderLoginPage({
              basePath: opts.basePath,
              title: resolvedAuth.loginTitle,
              identityLabel: resolvedAuth.identityLabel,
              identityValue: identity ?? '',
              csrfToken: newCsrfToken,
              error: '2FA is required but not configured properly.',
            });
            return new Response(html, {
              status: 500,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...opts.securityHeaders,
              },
            });
          }

          // Fully authenticated - create JWT and set auth cookie
          const user = result.user;
          const payload = createJwtPayload(
            user.id,
            user.identity,
            user.role,
            resolvedAuth.maxAge,
          );
          const token = await signJwt(payload, resolvedAuth.secret);
          const cookie = createAuthCookie(
            resolvedAuth.cookieName,
            token,
            resolvedAuth.maxAge,
            opts.basePath,
            isSecureRequest(request),
            resolvedAuth.sameSite,
          );

          return new Response(null, {
            status: 302,
            headers: {
              'Location': opts.basePath,
              'Set-Cookie': cookie,
              ...opts.securityHeaders,
            },
          });
        } catch (err) {
          // Log the error if handler provided
          if (opts.onError) {
            const error = err instanceof Error ? err : new Error(String(err));
            opts.onError(error, {
              source: 'handler',
              request,
              url,
              route: null,
              action: undefined,
            });
          }

          const newCsrfToken = await generateCsrfToken(csrfSecret);
          const html = renderLoginPage({
            basePath: opts.basePath,
            title: resolvedAuth.loginTitle,
            identityLabel: resolvedAuth.identityLabel,
            csrfToken: newCsrfToken,
            error: 'An unexpected error occurred. Please try again.',
          });
          return new Response(html, {
            status: 500,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              ...opts.securityHeaders,
            },
          });
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Validate JWT for all other routes
      // ─────────────────────────────────────────────────────────────
      const token = getTokenFromCookies(request, resolvedAuth.cookieName);

      if (token) {
        jwtPayload = await verifyJwt(token, resolvedAuth.secret);

        // Check if revoked
        if (jwtPayload && resolvedAuth.isRevoked) {
          const revoked = await resolvedAuth.isRevoked(jwtPayload);
          if (revoked) {
            jwtPayload = null;
          }
        }
      }

      // Redirect to login if not authenticated
      if (!jwtPayload) {
        if (wantsJson(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...opts.securityHeaders,
            },
          });
        }
        return new Response(null, {
          status: 302,
          headers: {
            'Location': loginPath,
            ...opts.securityHeaders,
          },
        });
      }

      // ─────────────────────────────────────────────────────────────
      // Account routes (when authenticated)
      // ─────────────────────────────────────────────────────────────
      const accountPath = `${opts.basePath}/account`;
      const provider = resolvedAuth.provider as PasswordProvider;

      // Create account route context
      // challengeSecret is undefined when 2FA is disabled. When twoFactorEnabled
      // is true, provider constructor guarantees it's ≥32 chars.
      const accountCtx: AccountRouteContext = {
        basePath: opts.basePath,
        title: opts.title,
        jwtPayload,
        provider,
        csrfSecret,
        challengeSecret: provider.challengeSecret,
        generateCsrfToken,
        validateCsrfToken,
      };

      // GET /account - Account settings page
      if (pathname === accountPath && request.method === 'GET') {
        return handleAccountPage(request, accountCtx);
      }

      // GET /account/password - Password change form
      if (pathname === `${accountPath}/password` && request.method === 'GET') {
        return handlePasswordChangeForm(request, accountCtx);
      }

      // POST /account/password - Process password change
      if (pathname === `${accountPath}/password` && request.method === 'POST') {
        return handlePasswordChange(request, accountCtx);
      }

      // GET /account/2fa - 2FA setup page
      if (pathname === `${accountPath}/2fa` && request.method === 'GET') {
        return handle2FASetupForm(request, accountCtx);
      }

      // POST /account/2fa/enable - Enable 2FA
      if (
        pathname === `${accountPath}/2fa/enable` && request.method === 'POST'
      ) {
        return handle2FAEnable(request, accountCtx);
      }

      // POST /account/2fa/disable - Disable 2FA
      if (
        pathname === `${accountPath}/2fa/disable` && request.method === 'POST'
      ) {
        return handle2FADisable(request, accountCtx);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Regular CMS routes
    // ─────────────────────────────────────────────────────────────

    // Every route below this point requires an authenticated caller. With
    // built-in auth the JWT check above already redirected or 401'd; with a
    // custom `isAuthenticated` callback this is the single gate. Keeping it
    // here (rather than per route family) means a new route cannot be added
    // below without inheriting it, and unauthenticated callers cannot probe
    // which tables or routes exist via 404/405 differences.
    if (!resolvedAuth) {
      const authenticated = await opts.isAuthenticated(request);
      if (!authenticated) {
        return forbidden('Authentication required');
      }
    }

    // Handle file serving at {basePath}/files/{table}/{column}/{id}[/{filename}]
    // Optional filename at end is ignored (for SEO-friendly URLs)
    const filesPrefix = `${opts.basePath}/files/`;
    if (pathname.startsWith(filesPrefix) && request.method === 'GET') {
      const filePath = pathname.slice(filesPrefix.length);
      const parts = filePath.split('/');

      if (parts.length === 3 || parts.length === 4) {
        const [tableName, columnName, recordId] = parts as [
          string,
          string,
          string,
        ];
        return handleFileServing(
          opts,
          tableName,
          columnName,
          recordId,
          request,
          jwtPayload,
        );
      }
    }

    // Parse the route - built-in CMS routes take precedence over plugins
    const route = parseRoute(url, opts.basePath, opts.introspected.tables);

    // ─────────────────────────────────────────────────────────────
    // Plugin routes - checked AFTER built-in CMS routes
    // Routes are namespaced: /admin/{pluginName}/{pattern}
    // Built-in table routes always win to prevent shadowing.
    // ─────────────────────────────────────────────────────────────
    if (!route) {
      const allPlugins = opts.plugins?.getPluginConfigs() ?? [];
      const pluginRouteMatch = matchPluginRoute(
        url,
        opts.basePath,
        request.method,
        allPlugins,
      );

      if (pluginRouteMatch) {
        // Authorization check - if plugin route references a table, check row policy
        // (canAccess was removed - use policies for table-level authorization)
        const pluginTable = pluginRouteMatch.params.table;
        if (pluginTable) {
          const tableInfo = opts.introspected.tables.find(
            (t) => t.name === pluginTable,
          );
          if (tableInfo) {
            // Row policy check for plugin routes with table context
            const policyCtx = createPolicyContext(
              request,
              jwtPayload
                ? { id: jwtPayload.sub, role: jwtPayload.role }
                : undefined,
            );
            const tablePolicy = opts.policies[tableInfo.name];
            const rowPolicy = extractRowPolicy(tablePolicy);
            const policyResult = await applyPolicy(
              rowPolicy,
              policyCtx,
              inferPluginRouteAction(request.method),
            );
            if (!policyResult.allowed) {
              return forbidden('Access denied');
            }
          }
        }

        // CSRF validation for POST requests (check header first, then form data)
        if (request.method === 'POST') {
          // Try header first (for JSON/API requests)
          let csrfToken = getCsrfTokenFromHeader(request);

          // If no header, fall back to reading the token from the form body.
          // The `formData()` parse below buffers the whole body, so enforce the
          // route's body cap *first* — streaming a clone and aborting once the
          // limit is exceeded — to keep an oversized body from being buffered
          // here, before `handlePluginRoute` gets a chance to cap it.
          if (!csrfToken) {
            const maxBody = pluginRouteMatch.route.maxBodySize ??
              DEFAULT_PLUGIN_ROUTE_MAX_BODY;
            const sizeGate = await readBodyWithLimit(request.clone(), maxBody);
            if (sizeGate.tooLarge) {
              return new Response('Request body too large', { status: 413 });
            }
            // Body is now known to be within the cap — safe to buffer it.
            const formData = await request.clone().formData().catch(() => null);
            if (formData) {
              const formToken = formData.get('__cms_csrf');
              if (typeof formToken === 'string') {
                csrfToken = formToken;
              }
            }
          }

          // CSRF token is required for all POST requests
          const csrfValid = csrfToken &&
            (await validateCsrfToken(csrfToken, opts.csrfSecret));
          if (!csrfValid) {
            return forbidden('Invalid CSRF token');
          }
        }

        return handlePluginRoute(
          pluginRouteMatch,
          request,
          opts,
          jwtPayload,
          pluginService,
        );
      }

      // No built-in route and no plugin route matched
      return notFound('Page not found');
    }

    // Resolve the action based on method
    const action = resolveAction(route, request.method);

    if (!action) {
      return methodNotAllowed(['GET', 'POST']);
    }

    // Check authorization for table actions via row policy
    // (canAccess was removed - use policies for table-level authorization)
    if (route.table && action !== 'dashboard') {
      const policyCtx = createPolicyContext(
        request,
        jwtPayload ? { id: jwtPayload.sub, role: jwtPayload.role } : undefined,
      );
      const tablePolicy = opts.policies[route.table.name];
      const rowPolicy = extractRowPolicy(tablePolicy);
      const policyResult = await applyPolicy(rowPolicy, policyCtx, action);
      if (!policyResult.allowed) {
        return forbidden('Access denied');
      }
    }

    // Build context
    const ctx: RouteContext = {
      request,
      options: opts,
      route,
      url,
      // Include auth user if authenticated via JWT
      authUser: jwtPayload
        ? {
          id: jwtPayload.sub,
          identity: typeof jwtPayload.identity === 'string'
            ? jwtPayload.identity
            : undefined,
          role: jwtPayload.role,
        }
        : undefined,
      // Plugin service for executing hooks
      pluginService: pluginService ?? undefined,
    };

    // Resolve flashes once per request: URL-derived first, then run through
    // the resolveFlashes plugin hook so plugins can add/remove/replace.
    {
      const fromUrl = parseFlashFromUrl(url);
      let flashes: FlashMessage[] = fromUrl ? [fromUrl] : [];
      if (pluginService) {
        try {
          flashes = await pluginService.resolveFlashes({
            flashes,
            action,
            table: route.table?.name,
            user: ctx.authUser
              ? { sub: ctx.authUser.id, role: ctx.authUser.role }
              : undefined,
          });
        } catch (err) {
          // resolveFlashes already catches per-plugin errors; this is defensive.
          const error = err instanceof Error ? err : new Error(String(err));
          opts.onError?.(error, {
            source: 'handler',
            request,
            url,
            route,
            table: route.table ?? undefined,
            action,
          });
        }
      }
      ctx.flashes = flashes;
    }

    // Dispatch to handler
    try {
      switch (action) {
        case 'dashboard':
          return await handleDashboard(ctx);
        case 'list':
          return await handleList(ctx);
        case 'read':
          return await handleRead(ctx);
        case 'create':
          return await handleCreate(ctx);
        case 'update':
          return await handleUpdate(ctx);
        case 'delete':
          return await handleDelete(ctx);
        default:
          return notFound('Unknown action');
      }
    } catch (err) {
      // Normalize to Error (handles thrown strings, objects, etc.)
      const error = err instanceof Error ? err : new Error(String(err));

      // Call user's error handler if provided
      if (opts.onError) {
        opts.onError(error, {
          source: 'handler',
          request,
          url,
          route,
          table: route.table ?? undefined,
          action,
        });
      }
      return new Response('Internal Server Error', {
        status: 500,
        headers: opts.securityHeaders,
      });
    }
  };

  if (rateLimitHints === false) {
    return handleRequest;
  }

  return async (request: Request): Promise<Response> => {
    let response = await handleRequest(request);
    const info = classifyCmsRequest(request, {
      basePath: opts.basePath,
      tables: opts.introspected.tables,
      plugins: opts.plugins?.getPluginConfigs() ?? [],
    });
    if (rateLimitHints === 'header') {
      try {
        response.headers.set(RATE_LIMIT_LEVEL_HEADER, String(info.level));
      } catch {
        // Immutable headers (Response.redirect(), or a Response proxied
        // straight from fetch() by a plugin route): rebuild so the
        // header-mode contract holds for every response.
        response = new Response(response.body, response);
        response.headers.set(RATE_LIMIT_LEVEL_HEADER, String(info.level));
      }
    }
    // After any rebuild, so the accessor is keyed to the returned object.
    storeRouteInfo(response, info);
    return response;
  };
}

/**
 * Serve a file stored in a JSON column
 *
 * Route: GET {basePath}/files/{table}/{column}/{id}
 *
 * Respects row and column policies - only serves files the user can read.
 */
async function handleFileServing(
  options: ResolvedCmsOptions,
  tableName: string,
  columnName: string,
  recordId: string,
  request: Request,
  jwtPayload: JwtPayload | null,
): Promise<Response> {
  // Find the table
  const table = options.introspected.tables.find((t) => t.name === tableName);
  if (!table) {
    return notFound('Table not found');
  }

  // Find the column
  const column = table.columns.find((c) => c.propertyName === columnName);
  if (!column) {
    return notFound('Column not found');
  }

  // Verify this is a file column
  if (!column.cmsOptions?.file) {
    return notFound('Not a file column');
  }

  // Apply policies
  const tablePolicy = options.policies?.[table.name];
  const rowPolicy = extractRowPolicy(tablePolicy);
  const columnPolicies = extractColumnPolicies(tablePolicy);

  const authUser = jwtPayload
    ? { id: jwtPayload.sub, role: jwtPayload.role }
    : undefined;

  // Optional source token: when present and valid, surfaces ctx.source to
  // policies so the same row policy can be evaluated consistently across the
  // picker list page and its thumbnail file fetches. An invalid token is
  // treated as no token (we don't 403 here — the row policy will deny if it
  // requires a specific source).
  const url = new URL(request.url);
  const rawSourceToken = url.searchParams.get('__cms_source');
  const source = rawSourceToken
    ? (await validateSourceToken(rawSourceToken, options.csrfSecret)) ??
      undefined
    : undefined;

  const policyCtx = createPolicyContext(request, authUser, source);

  // Check row read policy
  const policyResult = await applyPolicy(rowPolicy, policyCtx, 'read');
  if (!policyResult.allowed) {
    // Return 404 (not 403) to avoid leaking existence of records
    return notFound('Not found');
  }

  // Check column read policy
  const columnResult = await evaluateColumnPolicies(
    columnPolicies,
    table.columns,
    policyCtx,
  );
  if (!columnResult.readableColumns.includes(column.name)) {
    // Return 404 (not 403) to avoid leaking existence of columns
    return notFound('Not found');
  }

  // Fetch the record
  const drizzleTable = table.table as Table;
  const pkColumn = table.columns.find((c) => c.isPrimaryKey);
  if (!pkColumn) {
    return notFound('Table has no primary key');
  }

  // deno-lint-ignore no-explicit-any
  const pkField = (drizzleTable as any)[pkColumn.propertyName];
  const coercedId = pkColumn.dataType === 'number'
    ? parseInt(recordId, 10)
    : recordId;

  const result = await options.db
    .select()
    .from(drizzleTable)
    .where(
      policyResult.condition
        ? sql`${policyResult.condition} AND ${eq(pkField, coercedId)}`
        : eq(pkField, coercedId),
    )
    .limit(1);

  if (result.length === 0) {
    return notFound('Record not found');
  }

  const record = result[0] as Record<string, unknown>;
  const fileData = record[columnName];

  // Validate file reference
  if (!isValidFileReference(fileData)) {
    return notFound('No file found');
  }

  // If file has a URL (e.g., from S3 plugin), redirect to it
  if (fileData.url) {
    // Avoid open redirects / unsafe protocols (e.g., javascript:)
    try {
      const redirectUrl = new URL(fileData.url);
      if (
        redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:'
      ) {
        // Return 404 (not 403) to avoid leaking file existence
        return notFound('Not found');
      }
    } catch {
      // Return 404 (not 403) to avoid leaking file existence
      return notFound('Not found');
    }

    return new Response(null, {
      status: 302,
      headers: {
        'Location': fileData.url,
        ...options.securityHeaders,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // If file has storage + key, get signed URL from provider
  if (fileData.key) {
    // Defense-in-depth: validate key belongs to this table/column/record
    // Prevents signing arbitrary keys if DB is tampered with
    if (!isValidFileKey(fileData.key, tableName, columnName, recordId)) {
      return notFound('Invalid file key');
    }

    // Determine storage provider ID using fallback rules:
    // 1. Use explicit storage field if present
    // 2. Fall back to defaultObjectStorageId from config
    const storageId = fileData.storage ??
      options.storage?.defaultObjectStorageId;

    if (!storageId) {
      // No way to determine which provider to use
      return notFound('File storage not configured');
    }

    const provider = options.storage?.instances.get(storageId);
    if (!provider) {
      // Provider not found in registry
      return notFound('Storage provider not found');
    }

    if (!provider.signDownloadUrl) {
      // Provider doesn't support signed downloads
      return notFound('File serving not supported');
    }

    try {
      const signedUrl = await provider.signDownloadUrl({
        storage: storageId,
        key: fileData.key,
        filename: fileData.filename,
        request,
        user: jwtPayload
          ? { sub: jwtPayload.sub, role: jwtPayload.role }
          : null,
      });

      // Validate the signed URL
      try {
        const redirectUrl = new URL(signedUrl);
        if (
          redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:'
        ) {
          return notFound('Not found');
        }
      } catch {
        return notFound('Not found');
      }

      return new Response(null, {
        status: 302,
        headers: {
          'Location': signedUrl,
          ...options.securityHeaders,
          // Cache the redirect (not the signed URL itself) for 60 s.
          // The browser caches the 302, avoiding a DB + signing round-trip on
          // every grid/picker render. The Location URL carries its own expiry.
          'Cache-Control': 'private, max-age=60, must-revalidate',
        },
      });
    } catch (error) {
      // Log error and return generic failure
      options.onError?.(error as Error, {
        source: 'handler',
        request,
        url: new URL(request.url),
        route: null,
        table,
        action: 'read',
      });
      return notFound('File not available');
    }
  }

  // If file has base64 data, serve it directly
  if (fileData.data) {
    const bytes = base64ToUint8Array(fileData.data);
    // Ensure we have an ArrayBuffer-backed view (not SharedArrayBuffer)
    // to satisfy Deno's lib type expectations for BlobPart.
    const safeBytes = new Uint8Array(bytes);

    const contentType = (fileData.contentType || 'application/octet-stream')
      .toLowerCase();
    // Serve images inline except SVG, which can be scriptable when opened directly.
    const isImage = contentType.startsWith('image/');
    const isSvg = contentType === 'image/svg+xml' ||
      contentType.endsWith('+svg');
    const disposition = isImage && !isSvg ? 'inline' : 'attachment';

    // Much stricter CSP for file responses to mitigate scriptable content
    // if a browser decides to treat it as a document.
    const fileSecurityHeaders: Record<string, string> = {
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'none'; script-src 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    const body = new Blob([safeBytes], { type: contentType });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(safeBytes.length),
        'Content-Disposition': contentDispositionHeader(
          disposition,
          fileData.filename,
        ),
        ...fileSecurityHeaders,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  }

  // File has no data or URL
  return notFound('File data not available');
}
