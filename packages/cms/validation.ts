// Configuration validation using Zod
// Validates CmsOptions at startup and throws on invalid config

import { z } from 'zod';
import type { CspOptions } from './types.ts';

/**
 * Zod schema for CmsOptions validation
 *
 * Validates configuration at startup to catch errors early.
 * Throws ZodError with detailed messages for invalid config.
 */
/**
 * Schema for policies: either 'dangerously-open' literal or an object (can be empty for full access)
 */
const PoliciesSchema = z.union([
  z.literal('dangerously-open'),
  z.any().refine(
    (val) => val != null && typeof val === 'object',
    { message: 'policies must be an object or "dangerously-open"' },
  ),
], {
  message:
    "policies is required when auth is configured: provide table policies or 'dangerously-open' to bypass",
});

/**
 * Schema for auth configuration object (when not using 'dangerously-open')
 *
 * AuthProvider validation is minimal - we check that provider exists and has
 * an authenticate method. Full validation would require runtime testing.
 */
const AuthConfigSchema = z.object({
  provider: z.any().refine(
    (val) =>
      val != null &&
      typeof val === 'object' &&
      typeof val.authenticate === 'function',
    {
      message:
        'auth.provider must be an AuthProvider with an authenticate() method',
    },
  ),
  secret: z.string().min(32, {
    message: 'auth.secret must be at least 32 characters for security',
  }).optional(),
  maxAge: z.number().positive().optional(),
  cookieName: z.string().optional(),
  sameSite: z.enum(['Lax', 'Strict']).optional(),
  loginTitle: z.string().optional(),
  identityLabel: z.string().optional(),
  isRevoked: z.any().optional(),
});

/**
 * Base schema fields shared by all configurations
 */
const BaseOptionsSchema = z.object({
  // Required fields
  db: z.any().refine(
    (val) => val != null && typeof val === 'object',
    { message: 'db is required and must be a Drizzle database instance' },
  ),
  // Use z.any() for schema since Drizzle schemas have Symbol keys (e.g., Symbol.toStringTag)
  // that z.record(z.string(), z.any()) rejects
  schema: z.any().refine(
    (val) =>
      val != null && typeof val === 'object' && Object.keys(val).length > 0,
    { message: 'schema must be an object with at least one table' },
  ),
  // Optional fields with validation
  basePath: z.string()
    .regex(/^\//, { message: 'basePath must start with /' })
    .optional(),
  title: z.string()
    .min(1, { message: 'title cannot be empty' })
    .max(100, { message: 'title must be 100 characters or less' })
    .optional(),
  csrfSecret: z.string()
    .min(32, {
      message: 'csrfSecret must be at least 32 characters for security',
    })
    .optional(),
  // Functions validated as 'any' since Zod's function validation is complex
  // Runtime will fail anyway if these aren't callable
  isAuthenticated: z.any().optional(),
  onError: z.any().optional(),
});

/**
 * Schema for CMS with auth: 'dangerously-open'
 * Policies are still required (use 'dangerously-open' to bypass)
 */
const DangerouslyOpenAuthSchema = BaseOptionsSchema.extend({
  auth: z.literal('dangerously-open'),
  policies: PoliciesSchema,
});

/**
 * Schema for CMS with auth config (policies required at top level)
 */
const AuthenticatedSchema = BaseOptionsSchema.extend({
  auth: AuthConfigSchema,
  policies: PoliciesSchema,
});

/**
 * Combined schema: validates based on auth type
 *
 * Uses check() to route to the correct schema based on auth value,
 * providing better error messages than a plain union.
 */
export const CmsOptionsSchema: z.ZodType<unknown> = z.any().check((ctx) => {
  const data = ctx.value;

  if (data == null || typeof data !== 'object') {
    ctx.issues.push({
      code: 'custom',
      message: 'Configuration must be an object',
      input: data,
      path: [],
    });
    return;
  }

  // Route to correct schema based on auth value
  if (data.auth === 'dangerously-open') {
    const result = DangerouslyOpenAuthSchema.safeParse(data);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.issues.push({ ...issue, input: data });
      }
    }
    return;
  }

  // Auth is object or undefined - validate with AuthenticatedSchema
  const result = AuthenticatedSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.issues.push({ ...issue, input: data });
    }
  }
});

/**
 * Type for resolved secrets after env var fallback
 */
export interface ResolvedSecrets {
  csrfSecret: string;
  authSecret?: string;
}

/**
 * Schema for resolved secrets (after env var fallback).
 * Used internally after resolving CMS_JWT_SECRET and CMS_CSRF_SECRET.
 */
export const ResolvedSecretsSchema: z.ZodType<ResolvedSecrets> = z.object({
  csrfSecret: z.string().min(32, {
    message: 'csrfSecret must be at least 32 characters. ' +
      'Either pass csrfSecret directly or set CMS_CSRF_SECRET environment variable. ' +
      'Generate one with: openssl rand -base64 32',
  }),
  authSecret: z.string().min(32, {
    message: 'auth.secret must be at least 32 characters. ' +
      'Either pass auth.secret directly or set CMS_JWT_SECRET environment variable.',
  }).optional(),
});

/**
 * Custom error class for CMS configuration errors
 */
export class CmsConfigError extends Error {
  constructor(message: string, public details?: z.ZodError) {
    super(message);
    this.name = 'CmsConfigError';
  }
}

/**
 * Validate CmsOptions and throw on invalid configuration
 *
 * @throws {CmsConfigError} When configuration is invalid
 */
export function validateCmsOptions(options: unknown): void {
  const result = CmsOptionsSchema.safeParse(options);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        // Zod paths can contain Symbols (from object keys), which throw on join()
        const path = issue.path
          .map((p) =>
            typeof p === 'symbol' ? (p.description ?? 'symbol') : String(p)
          )
          .join('.');
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new CmsConfigError(
      `Invalid CMS configuration:\n${issues}`,
      result.error,
    );
  }
}

/**
 * Validate resolved secrets (after env var fallback)
 * Returns the validated secrets with proper types (csrfSecret is guaranteed defined)
 *
 * @throws {CmsConfigError} When secrets are missing or invalid
 */
export function validateResolvedSecrets(secrets: {
  csrfSecret: string | undefined;
  authSecret: string | undefined;
}): { csrfSecret: string; authSecret: string | undefined } {
  const result = ResolvedSecretsSchema.safeParse(secrets);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new CmsConfigError(
      `Invalid CMS configuration:\n${issues}`,
      result.error,
    );
  }

  return result.data as { csrfSecret: string; authSecret: string | undefined };
}

/**
 * Validate file columns: JSON-compatible types and config shape.
 * File columns (marked with `$cms({ file: true })` or `$cms({ file: { ... } })`)
 * must be on jsonb/json columns. Also validates file config options.
 *
 * @throws {CmsConfigError} When file config is invalid
 */
export function validateFileColumnsAndConfigs(
  introspected: {
    tables: Array<
      {
        name: string;
        columns: Array<
          {
            propertyName: string;
            dataType: string;
            cmsOptions?: {
              file?: boolean | {
                accept?: string;
                maxSize?: number;
                previewSvg?: boolean;
              };
            };
          }
        >;
      }
    >;
  },
): void {
  const errors: string[] = [];

  for (const table of introspected.tables) {
    for (const column of table.columns) {
      const fileConfig = column.cmsOptions?.file;
      if (!fileConfig) continue;

      if (column.dataType !== 'json') {
        errors.push(
          `  - ${table.name}.${column.propertyName}: { file: ... } requires a JSON column (jsonb/json), ` +
            `but column has dataType '${column.dataType}'. ` +
            `Use jsonb() (Postgres), json() (MySQL), or text({ mode: 'json' }) (SQLite).`,
        );
      }

      if (typeof fileConfig === 'object') {
        const { accept, maxSize, previewSvg } = fileConfig;
        if (accept !== undefined && typeof accept !== 'string') {
          errors.push(
            `  - ${table.name}.${column.propertyName}: file.accept must be a string when provided.`,
          );
        }
        if (maxSize !== undefined) {
          if (typeof maxSize !== 'number' || maxSize < 0) {
            errors.push(
              `  - ${table.name}.${column.propertyName}: file.maxSize must be a non-negative number when provided.`,
            );
          }
        }
        if (previewSvg !== undefined && typeof previewSvg !== 'boolean') {
          errors.push(
            `  - ${table.name}.${column.propertyName}: file.previewSvg must be a boolean when provided.`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new CmsConfigError(
      `Invalid file column configuration:\n${errors.join('\n')}`,
    );
  }
}

/**
 * Validate autoDraft table option.
 *
 * Tables with `$cms({ autoDraft: true })` must have every non-PK column
 * either nullable or with a database default. Otherwise the CMS can't
 * `INSERT … DEFAULT VALUES` to create a draft row.
 *
 * @throws {CmsConfigError} When autoDraft is set on incompatible tables
 */
export function validateAutoDraft(
  introspected: {
    tables: Array<
      {
        name: string;
        cmsOptions?: { autoDraft?: boolean };
        columns: Array<
          {
            propertyName: string;
            isPrimaryKey: boolean;
            hasDefault: boolean;
            notNull: boolean;
          }
        >;
      }
    >;
  },
): void {
  const errors: string[] = [];

  for (const table of introspected.tables) {
    if (!table.cmsOptions?.autoDraft) continue;

    const blocking = table.columns.filter((col) => {
      if (col.isPrimaryKey && col.hasDefault) return false;
      if (col.hasDefault) return false;
      if (!col.notNull) return false;
      return true;
    });

    if (blocking.length > 0) {
      const cols = blocking.map((c) => c.propertyName).join(', ');
      errors.push(
        `  - ${table.name}: autoDraft requires all non-PK columns to have defaults or be nullable. ` +
          `Blocking column(s): ${cols}. ` +
          `Add .default(...) or remove .notNull() from these columns.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new CmsConfigError(
      `Invalid autoDraft configuration:\n${errors.join('\n')}`,
    );
  }
}

/**
 * Validate CSP directive values.
 * Origin-only directives (imgSrc, connectSrc, frameSrc) must be http/https URL origins.
 * Source directives (styleSrc) also accept CSP keywords, hashes, and nonces.
 *
 * @throws {CmsConfigError} When any value is invalid
 */
export function validateCspOptions(
  csp: CspOptions,
): void {
  const errors: string[] = [];

  // Origin-only directives (only http/https URLs allowed)
  const originDirectives: [string, string[] | undefined][] = [
    ['imgSrc', csp.imgSrc],
    ['connectSrc', csp.connectSrc],
    ['frameSrc', csp.frameSrc],
  ];

  for (const [name, origins] of originDirectives) {
    if (!origins) continue;
    for (const origin of origins) {
      const err = validateOrigin(origin);
      if (err) {
        errors.push(`  - csp.${name}: ${err}`);
      }
    }
  }

  // Directives that also allow CSP keywords (e.g., 'unsafe-inline', hashes, nonces)
  const sourceDirectives: [string, string[] | undefined][] = [
    ['styleSrc', csp.styleSrc],
  ];

  for (const [name, sources] of sourceDirectives) {
    if (!sources) continue;
    for (const source of sources) {
      const err = validateCspSource(source);
      if (err) {
        errors.push(`  - csp.${name}: ${err}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new CmsConfigError(
      `Invalid CSP configuration:\n${errors.join('\n')}`,
    );
  }
}

/**
 * Validate that tables have at most one thumbnail column.
 * Multiple thumbnail columns would be ambiguous for grid view rendering.
 *
 * @throws {CmsConfigError} When a table has multiple thumbnail columns
 */
export function validateThumbnailColumns(
  introspected: {
    tables: Array<
      {
        name: string;
        columns: Array<
          {
            propertyName: string;
            cmsOptions?: {
              thumbnail?: boolean;
            };
          }
        >;
      }
    >;
  },
): void {
  const errors: string[] = [];

  for (const table of introspected.tables) {
    const thumbnailCols = table.columns.filter((c) => c.cmsOptions?.thumbnail);
    if (thumbnailCols.length > 1) {
      const colNames = thumbnailCols.map((c) => c.propertyName).join(', ');
      errors.push(
        `  - ${table.name}: multiple thumbnail columns found (${colNames}). ` +
          `Only one column per table may have thumbnail: true.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new CmsConfigError(
      `Invalid thumbnail configuration:\n${errors.join('\n')}`,
    );
  }
}

/**
 * Validate a single CSP origin string.
 * Must be scheme + host (+ optional port), no path/query/fragment.
 */
function validateOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `'${origin}' must use http: or https: scheme`;
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return `'${origin}' must be an origin (scheme + host), not a full URL with path/query`;
    }
    return null;
  } catch {
    return `'${origin}' is not a valid URL origin`;
  }
}

/** Recognized CSP keyword sources */
const CSP_KEYWORDS = new Set(["'unsafe-inline'", "'unsafe-hashes'"]);

/** Pattern for CSP hash sources: 'sha256-...', 'sha384-...', 'sha512-...' */
const CSP_HASH_RE = /^'(sha256|sha384|sha512)-[A-Za-z0-9+/]+=*'$/;

/** Pattern for CSP nonce sources: 'nonce-...' */
const CSP_NONCE_RE = /^'nonce-[A-Za-z0-9+/=_-]+'$/;

/**
 * Validate a CSP source value.
 * Accepts URL origins AND CSP keywords/hashes/nonces.
 * Blocks dangerous keywords like 'unsafe-eval'.
 */
function validateCspSource(source: string): string | null {
  // CSP keyword (single-quoted)
  if (source.startsWith("'") && source.endsWith("'")) {
    if (source === "'unsafe-eval'") {
      return `'unsafe-eval' is not allowed — it enables arbitrary code execution`;
    }
    if (
      CSP_KEYWORDS.has(source) ||
      CSP_HASH_RE.test(source) ||
      CSP_NONCE_RE.test(source)
    ) {
      return null;
    }
    return `${source} is not a recognized CSP source`;
  }
  // URL origin
  return validateOrigin(source);
}
