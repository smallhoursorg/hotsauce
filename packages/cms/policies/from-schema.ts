// Generate policies from schema $cms() hints
// Extracts plugin access configuration from columns and builds policy objects

import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import type { PluginColumnConfig } from '@hotsauce/core';
import { pluginSource } from '../tokens/source.ts';
import type {
  ColumnPolicies,
  Policies,
  PolicyContext,
  TablePolicy,
} from './types.ts';

/**
 * Normalize a PluginColumnConfig to a standardized object form.
 *
 * - `true` → `{ write: true, read: true }`
 * - `{ write: true }` → as-is
 */
function normalizePluginConfig(
  config: PluginColumnConfig,
): { write?: boolean; read?: boolean } {
  if (config === true) {
    return { write: true, read: true };
  }
  return { write: config.write, read: config.read };
}

/**
 * Check if a source is allowed to write based on plugin configuration.
 *
 * @param allowedSources - Array of source identifiers that are allowed
 * @param ctx - Policy context with source
 * @returns True if the source is allowed
 */
function isSourceAllowed(
  allowedSources: string[],
  ctx: PolicyContext,
): boolean {
  // Source token is required - if missing, deny the write
  if (!ctx.source) {
    return false;
  }

  return allowedSources.includes(ctx.source);
}

/**
 * Deep merge policies, with user policies taking precedence.
 *
 * For each table:
 * - If user provides a simple Policy, it replaces the generated one
 * - If user provides a TablePolicy, it's merged at the row/columns level
 * - Column policies from user override generated ones for the same column
 */
function mergePolicies(
  generated: Policies,
  userProvided: Policies,
): Policies {
  const result: Policies = { ...generated };

  for (const [tableName, userPolicy] of Object.entries(userProvided)) {
    const existingPolicy = result[tableName];

    // No existing policy? Use user's directly
    if (!existingPolicy) {
      result[tableName] = userPolicy;
      continue;
    }

    // User provides a simple Policy (function or ActionPolicies)
    if (
      typeof userPolicy === 'function' ||
      !('row' in userPolicy || 'columns' in userPolicy)
    ) {
      // Replace entirely - user takes precedence
      result[tableName] = userPolicy;
      continue;
    }

    // Both are TablePolicy - merge them
    const existingTablePolicy = existingPolicy as TablePolicy;
    const userTablePolicy = userPolicy as TablePolicy;

    const mergedTablePolicy: TablePolicy = {};

    // Row policy: user wins if provided
    if (userTablePolicy.row !== undefined) {
      mergedTablePolicy.row = userTablePolicy.row;
    } else if (existingTablePolicy.row !== undefined) {
      mergedTablePolicy.row = existingTablePolicy.row;
    }

    // Column policies: merge, user wins on conflict
    if (existingTablePolicy.columns || userTablePolicy.columns) {
      mergedTablePolicy.columns = {
        ...existingTablePolicy.columns,
        ...userTablePolicy.columns,
      };
    }

    result[tableName] = mergedTablePolicy;
  }

  return result;
}

/**
 * Extract policies from a Drizzle schema based on `$cms()` plugin hints.
 *
 * This function reads column metadata to generate column-level write policies
 * that restrict which sources (CMS core or plugins) can modify each column.
 *
 * @param schema - Drizzle schema object containing tables
 * @param additionalPolicies - User-provided policies to merge (take precedence)
 * @returns Combined policies object
 *
 * @example
 * ```ts
 * // schema.ts
 * export const pages = pgTable('pages', {
 *   id: serial('id').primaryKey(),
 *   title: text('title'),
 *   content: json('content').$cms({ plugins: { puck: true } }),
 * });
 *
 * // server.ts
 * import { policiesFromSchema, ownedBy } from '@hotsauce/cms';
 *
 * const handler = createCmsHandler({
 *   db,
 *   schema,
 *   auth: { provider },
 *   policies: policiesFromSchema(schema, {
 *     // Additional row policies
 *     pages: ownedBy(schema.pages, 'authorId'),
 *   }),
 * });
 * ```
 *
 * **How it works:**
 *
 * 1. Iterates through all tables in the schema
 * 2. For each column with `$cms({ plugins: {...} })`, extracts allowed plugins
 * 3. Generates a `write` policy that checks `ctx.source` against allowed plugins
 * 4. Merges with user-provided policies (user wins on conflict)
 *
 * **Default behavior:**
 *
 * - Columns with `$cms({ plugins: ... })` hints can be restricted to specific plugin sources.
 * - Columns without plugin hints behave normally (no additional restrictions added by this helper).
 *
 * @example
 * ```ts
 * // This column can only be written by the puck plugin
 * content: json().$cms({ plugins: { puck: true } })
 *
 * // Generates effective policy:
 * // write: (ctx) => ctx.source === 'plugin:puck'
 *
 * // Multiple plugins
 * content: json().$cms({ plugins: { puck: true, 'block-editor': { write: true } } })
 * // write: (ctx) => ['plugin:puck', 'plugin:block-editor'].includes(ctx.source)
 * ```
 */
export function policiesFromSchema(
  schema: Record<string, unknown>,
  additionalPolicies: Policies = {},
): Policies {
  const generated: Policies = {};

  for (const [_key, value] of Object.entries(schema)) {
    // Check if this is a Drizzle table
    if (!isTable(value)) continue;

    const tableName = getTableName(value);
    const columns = getTableColumns(value);
    const columnPolicies: ColumnPolicies = {};

    for (const [propertyName, column] of Object.entries(columns)) {
      // Get CMS options from column config
      // deno-lint-ignore no-explicit-any
      const config = (column as any).config as
        | { cmsOptions?: { plugins?: Record<string, PluginColumnConfig> } }
        | undefined;

      const plugins = config?.cmsOptions?.plugins;
      if (!plugins) continue;

      // Find all plugins that have write access
      const allowedSources: string[] = [];

      for (const [pluginName, pluginConfig] of Object.entries(plugins)) {
        const normalized = normalizePluginConfig(pluginConfig);
        if (normalized.write) {
          allowedSources.push(pluginSource(pluginName));
        }
      }

      // If any plugins are explicitly allowed to write, generate a write policy
      if (allowedSources.length > 0) {
        // Column policies are keyed by the Drizzle property name (the key in
        // the table definition), matching evaluateColumnPolicies().
        columnPolicies[propertyName] = {
          write: (ctx: PolicyContext) => isSourceAllowed(allowedSources, ctx),
        };
      }
    }

    // Only add policy entry if we found plugin configs
    if (Object.keys(columnPolicies).length > 0) {
      generated[tableName] = { columns: columnPolicies };
    }
  }

  // Merge with user-provided policies (user takes precedence)
  return mergePolicies(generated, additionalPolicies);
}

/**
 * Get allowed plugin sources for a specific column.
 *
 * Useful for checking which plugins are configured to access a column
 * without generating full policy objects.
 *
 * @param schema - Drizzle schema object
 * @param tableName - Name of the table
 * @param columnName - Name of the column
 * @returns Array of allowed source identifiers, or empty if no plugins configured
 *
 * @example
 * ```ts
 * const sources = getColumnPluginSources(schema, 'pages', 'content');
 * // ['plugin:puck'] if puck is configured
 * ```
 */
export function getColumnPluginSources(
  schema: Record<string, unknown>,
  tableName: string,
  columnName: string,
): string[] {
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    if (getTableName(value) !== tableName) continue;

    const columns = getTableColumns(value);
    // deno-lint-ignore no-explicit-any
    const column = (columns as any)[columnName];
    if (!column) return [];

    // deno-lint-ignore no-explicit-any
    const config = (column as any).config as
      | { cmsOptions?: { plugins?: Record<string, PluginColumnConfig> } }
      | undefined;

    const plugins = config?.cmsOptions?.plugins;
    if (!plugins) return [];

    const sources: string[] = [];
    for (const [pluginName, pluginConfig] of Object.entries(plugins)) {
      const normalized = normalizePluginConfig(pluginConfig);
      if (normalized.write) {
        sources.push(pluginSource(pluginName));
      }
    }
    return sources;
  }

  return [];
}
