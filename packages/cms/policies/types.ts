// Policy types for row-level security style authorization
// Policies return Drizzle SQL conditions that are applied to queries
// Also includes column-level permissions for field visibility and editability

import type { SQL } from 'drizzle-orm';
import type { CrudAction } from '../types.ts';

// ============================================================================
// Column Policy Types
// ============================================================================

/**
 * Result from a column policy function:
 * - `true`: Access granted
 * - `false`: Access denied
 */
export type ColumnPolicyResult = boolean;

/**
 * Column policy function signature
 *
 * @param ctx - Context with authenticated user info
 * @returns boolean indicating if access is allowed
 *
 * @example
 * ```ts
 * // Only admins can see salary
 * const canReadSalary: ColumnPolicyFn = (ctx) => ctx.user?.role === 'admin';
 *
 * // No one can see SSN in the CMS
 * const canReadSsn: ColumnPolicyFn = () => false;
 * ```
 */
export type ColumnPolicyFn = (
  ctx: PolicyContext,
) => ColumnPolicyResult | Promise<ColumnPolicyResult>;

/**
 * Column policy definition
 *
 * Controls visibility and editability of individual columns.
 * Used for hiding sensitive data and auto-filling system columns.
 *
 * Semantics:
 * - `read: false` → Column hidden entirely (list, detail, edit views)
 * - `read: true, write: false` → Column visible but read-only in forms
 * - `write: true` implies `read: true` (can't edit what you can't see)
 *
 * For hidden required columns, provide a `default` function to auto-fill values.
 * This enables multi-tenant patterns where tenantId is auto-filled from user context.
 *
 * Keys are Drizzle property names (`passwordHash`), not DB column names.
 *
 * @example
 * ```ts
 * columns: {
 *   // Hidden from everyone in CMS
 *   passwordHash: { read: () => false },
 *
 *   // Only admins can see
 *   salary: { read: (ctx) => ctx.user?.role === 'admin' },
 *
 *   // Everyone sees, only admins edit
 *   status: { write: (ctx) => ctx.user?.role === 'admin' },
 *
 *   // Hidden but auto-filled on create (multi-tenant pattern)
 *   tenantId: {
 *     read: () => false,
 *     write: () => false,
 *     default: (ctx) => ctx.user?.tenantId ?? 'default',
 *   },
 * }
 * ```
 */
export interface ColumnPolicy {
  /**
   * Whether the column is visible.
   * If false, column is hidden from list, detail, and edit views.
   * Defaults to true if not specified.
   */
  read?: ColumnPolicyFn;

  /**
   * Whether the column is editable.
   * If false, column is shown as read-only in edit forms.
   * Defaults to matching `read` if not specified.
   */
  write?: ColumnPolicyFn;

  /**
   * Default value for hidden required columns.
   *
   * REQUIRED when:
   * - `write` returns false (or is not specified when `read` is false)
   * - AND the column is NOT NULL without a schema default
   *
   * This enables multi-tenant patterns where system columns are
   * auto-filled from user context without being visible/editable.
   *
   * Validated at config time - throws CmsConfigError if a required
   * column is hidden without a default.
   *
   * @example
   * ```ts
   * // Auto-fill tenantId from user's JWT claim
   * tenantId: {
   *   read: () => false,
   *   default: (ctx) => ctx.user?.tenantId,
   * }
   * ```
   */
  default?: (ctx: PolicyContext) => unknown;
}

/**
 * Column policies keyed by the Drizzle property name (the key in the table
 * definition, e.g. `passwordHash`), never the database column name
 * (`password_hash`). A policy keyed by the DB name silently matches nothing.
 *
 * @example
 * ```ts
 * const userColumns: ColumnPolicies = {
 *   passwordHash: { read: () => false },
 *   ssn: { read: () => false },
 *   salary: { read: (ctx) => ctx.user?.role === 'admin' },
 * };
 * ```
 */
export type ColumnPolicies = Record<string, ColumnPolicy>;

// ============================================================================
// Row Policy Types
// ============================================================================

/**
 * Context passed to policy functions
 * Contains the authenticated user and request metadata
 */
export interface PolicyContext {
  /** Authenticated user from JWT (undefined if not using auth) */
  user?: {
    /** User ID from JWT subject claim */
    sub: string;
    /** User role from JWT (if provided) */
    role?: string;
  };
  /** The original request (for advanced use cases) */
  request: Request;
  /**
   * Source of the form submission
   *
   * - `'cms'`: Request from CMS core forms
   * - `'plugin:{name}'`: Request from a plugin (e.g., 'plugin:puck')
   * - `undefined`: Source token not validated (legacy or no auth)
   *
   * Use this in column policies to restrict plugin access:
   * ```ts
   * columns: {
   *   content: {
   *     write: (ctx) => ctx.source === 'plugin:puck',
   *   }
   * }
   * ```
   */
  source?: string;
}

/**
 * Result from a policy function:
 * - `SQL` condition: Filter is applied to query (e.g., `WHERE author_id = 'user-123'`)
 * - `undefined`: No filter applied (full access)
 * - `false`: Access denied (returns 403)
 *
 * Note: Returning `sql\`false\`` filters all rows (0 results).
 * Returning the literal `false` value immediately denies access with 403.
 */
export type PolicyResult = SQL | undefined | false;

/**
 * Policy function signature
 *
 * @param ctx - Context with authenticated user info
 * @param action - The CRUD action being performed
 * @returns SQL condition, undefined (no filter), or false (deny)
 *
 * @example
 * ```ts
 * const postsPolicy: PolicyFn = (ctx, action) => {
 *   if (ctx.user?.role === 'admin') return undefined; // No filter
 *   if (!ctx.user) return false; // Deny access
 *   return eq(posts.authorId, ctx.user.sub); // Filter to owned
 * };
 * ```
 */
export type PolicyFn = (
  ctx: PolicyContext,
  action: CrudAction,
) => PolicyResult | Promise<PolicyResult>;

/**
 * Action-specific policy object
 * Define different policies for different CRUD actions
 *
 * @example
 * ```ts
 * const postsPolicy: ActionPolicies = {
 *   list: (ctx) => eq(posts.status, 'published'),
 *   read: (ctx) => eq(posts.status, 'published'),
 *   create: (ctx) => ctx.user ? undefined : false,
 *   update: (ctx) => eq(posts.authorId, ctx.user?.sub ?? ''),
 *   delete: (ctx) => ctx.user?.role === 'admin' ? undefined : false,
 * };
 * ```
 */
export type ActionPolicies =
  & {
    [K in CrudAction]?: PolicyFn;
  }
  & {
    /** Fallback policy for actions not explicitly defined */
    '*'?: PolicyFn;
  };

/**
 * Policy definition - either a single function or action-specific policies
 */
export type Policy = PolicyFn | ActionPolicies;

/**
 * Table policy with optional column-level permissions
 *
 * Combines row-level filtering with column-level visibility/editability.
 *
 * @example
 * ```ts
 * const usersTablePolicy: TablePolicy = {
 *   // Row-level: users see only their own records
 *   row: ownedBy(users, 'id'),
 *
 *   // Column-level: hide sensitive fields
 *   columns: {
 *     passwordHash: { read: () => false },
 *     salary: { read: (ctx) => ctx.user?.role === 'admin' },
 *     tenantId: {
 *       read: () => false,
 *       default: (ctx) => ctx.user?.tenantId,
 *     },
 *   },
 * };
 * ```
 */
export interface TablePolicy {
  /**
   * Row-level policy (optional).
   * Filters which records are visible/accessible.
   * If not specified, all rows are accessible.
   */
  row?: Policy;

  /**
   * Column-level policies (optional).
   * Controls visibility and editability of specific columns.
   * Columns not listed have full read/write access.
   */
  columns?: ColumnPolicies;
}

/**
 * Policies configuration keyed by table name
 *
 * Each table can have:
 * - A simple row policy (PolicyFn or ActionPolicies)
 * - A full TablePolicy with row + column policies
 *
 * @example
 * ```ts
 * const policies: Policies = {
 *   // Simple row policy
 *   posts: ownedBy(posts, 'authorId'),
 *
 *   // Action-specific row policy
 *   comments: {
 *     list: () => undefined,
 *     create: (ctx) => ctx.user ? undefined : false,
 *     update: ownedBy(comments, 'userId'),
 *   },
 *
 *   // Full table policy with columns
 *   users: {
 *     row: adminOr(ownedBy(users, 'id')),
 *     columns: {
 *       passwordHash: { read: () => false },
 *       salary: { read: (ctx) => ctx.user?.role === 'admin' },
 *     },
 *   },
 *
 *   // Columns only (no row filtering)
 *   settings: {
 *     columns: {
 *       apiKey: { read: (ctx) => ctx.user?.role === 'admin' },
 *     },
 *   },
 * };
 * ```
 */
export type Policies = Record<string, Policy | TablePolicy>;

/**
 * Result of applying a policy to determine access
 */
export interface PolicyApplicationResult {
  /** Whether access is allowed */
  allowed: boolean;
  /** SQL condition to apply to query (if allowed and has filter) */
  condition?: SQL;
}
