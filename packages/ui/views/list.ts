// List view - table of records

import { attrs, escapeHtml, getSafeUrl, html, raw } from '../html.ts';
import type { CMSField } from '@hotsauce/core';
import { isValidFileReference } from '@hotsauce/core';
import type { FieldUIOverride } from '@hotsauce/workers';
import type { RelationOption } from '../forms/inputs.ts';
import {
  viewToggle,
  type ViewToggleOptions,
} from '../components/view-toggle.ts';

/**
 * Display data for many-to-many relations in list/detail views
 */
export interface ManyToManyDisplayData {
  /** Form field name key (e.g., 'categoriesIds') */
  fieldName: string;
  /** Display label (e.g., 'Categories') */
  label: string;
  /** The selected values as display labels (pre-resolved) */
  displayValues: string[];
}

/**
 * Column configuration for list view
 */
export interface ListColumn {
  /** Column key: the Drizzle property name, used to read record values */
  key: string;
  /** Display label */
  label: string;
  /** Format function for cell value */
  format?: (value: unknown) => string;
}

/**
 * Cell overrides map: recordId -> columnKey -> FieldUIOverride
 * Used to render plugin links in list cells.
 */
export type CellOverrides = Map<
  string | number,
  Record<string, FieldUIOverride>
>;

/**
 * Options for list view
 */
export interface ListViewOptions {
  /** Base URL for record links (e.g., /admin/posts) */
  baseUrl: string;
  /** Primary key field name (default: id) */
  primaryKey?: string;
  /** Show edit action */
  showEdit?: boolean;
  /** Show delete action */
  showDelete?: boolean;
  /** Show view action */
  showView?: boolean;
  /** CSRF token for delete forms */
  csrfToken?: string;
  /** Additional CSS classes */
  class?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** View toggle configuration (renders grid/table toggle buttons) */
  viewToggle?: ViewToggleOptions;
}

/**
 * Fallback character cap for plain-text list cells. The primary line limit is
 * the CSS 2-line clamp on `.cms-cell-text` (see styles.ts); this cap keeps the
 * rendered HTML small for browsers without `-webkit-line-clamp` support.
 */
const TEXT_CELL_MAX_LENGTH = 100;

/**
 * Default value formatter
 */
function defaultFormat(
  value: unknown,
  relationOptions?: RelationOption[],
): string {
  if (value === null || value === undefined) {
    return '<span class="cms-null">—</span>';
  }

  // For relation fields, show ID and display label in brackets
  if (relationOptions) {
    const option = relationOptions.find((o) =>
      String(o.value) === String(value)
    );
    if (option) {
      return escapeHtml(`${String(value)} (${option.label})`);
    }
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  if (typeof value === 'boolean') {
    return value ? '✓' : '✗';
  }
  if (typeof value === 'object') {
    // Check if this is a file reference
    if (isValidFileReference(value)) {
      return `<span class="cms-file-badge" title="${
        escapeHtml(value.contentType)
      }">📄 ${escapeHtml(value.filename)}</span>`;
    }
    return '<span class="cms-json">[JSON]</span>';
  }

  // Plain text: cap length as a fallback for the CSS 2-line clamp, then escape.
  // The value is shown faithfully (any stored markup appears as escaped text,
  // bounded by the clamp) — we do not strip tags, which would corrupt plain-text
  // values containing `<word>` and mis-handle entities. Truncate the raw string
  // BEFORE escaping so we never cut through an entity sequence like `&amp;`. The
  // `cms-cell-text` wrapper carries the clamp and is applied only here, so
  // trusted cell markup (badges, JSON, links, null dashes) stays unclamped. When
  // truncated, expose the full value via a `title` tooltip.
  const str = String(value);
  const truncated = str.length > TEXT_CELL_MAX_LENGTH
    ? str.slice(0, TEXT_CELL_MAX_LENGTH) + '…'
    : str;
  const title = str.length > TEXT_CELL_MAX_LENGTH
    ? ` title="${escapeHtml(str)}"`
    : '';
  return `<span class="cms-cell-text"${title}>${escapeHtml(truncated)}</span>`;
}

/**
 * Render a data table for listing records
 */
export function listTable(
  columns: ListColumn[],
  records: Record<string, unknown>[],
  options: ListViewOptions,
  relationData: Record<string, RelationOption[]> = {},
  manyToManyData: Map<string | number, ManyToManyDisplayData[]> = new Map(),
  cellOverrides: CellOverrides = new Map(),
): string {
  const primaryKey = options.primaryKey ?? 'id';
  const showActions = options.showEdit || options.showDelete ||
    options.showView;
  const emptyMessage = options.emptyMessage ?? 'No records found.';

  if (records.length === 0) {
    return html`
      <div class="cms-empty">
        <p>${emptyMessage}</p>
        <a href="${options
          .baseUrl}/new" class="cms-btn cms-btn-primary">Create New</a>
      </div>
    `;
  }

  // Get M2M column labels from first record's M2M data (all records have same relations)
  const m2mLabels: string[] = [];
  if (manyToManyData.size > 0) {
    const firstM2M = manyToManyData.values().next().value as
      | ManyToManyDisplayData[]
      | undefined;
    if (firstM2M) {
      for (const m2m of firstM2M) {
        m2mLabels.push(m2m.label);
      }
    }
  }

  const headerCells = columns.map((col) =>
    html`
      <th class="cms-th">${col.label}</th>
    `
  ).join('\n      ');

  const m2mHeaderCells = m2mLabels.map((label) =>
    html`
      <th class="cms-th">${label}</th>
    `
  ).join('\n      ');

  const rows = records.map((record) => {
    const id = record[primaryKey] as string | number;
    const recordOverrides = cellOverrides.get(id) ?? {};
    const cells = columns.map((col) => {
      // Check for plugin override
      const override = recordOverrides[col.key];
      if (override?.link || override?.valueSummary) {
        // Build summary text (e.g., "8 blocks")
        const summaryHtml = override.valueSummary
          ? `<span class="cms-value-summary">${
            escapeHtml(override.valueSummary)
          }</span>`
          : '';

        // Build link button (e.g., "Edit with Puck ↗")
        // Validate URL to prevent javascript:/data: scheme injection
        let linkHtml = '';
        if (override.link) {
          const safeHref = getSafeUrl(override.link.href);
          if (safeHref) {
            const { label, target } = override.link;
            const targetAttr = target === '_blank'
              ? ' target="_blank" rel="noopener"'
              : '';
            const arrow = target === '_blank' ? ' ↗' : '';
            linkHtml = `<a href="${
              escapeHtml(safeHref)
            }" class="cms-action"${targetAttr}>${
              escapeHtml(label)
            }${arrow}</a>`;
          }
        }

        // Show both summary and link if both exist
        const content = summaryHtml && linkHtml
          ? `${summaryHtml} ${linkHtml}`
          : summaryHtml || linkHtml;

        // Only use override if we have content, otherwise fall back to default
        if (content) {
          return `<td class="cms-td">${content}</td>`;
        }
      }
      const value = record[col.key];
      const formatted = col.format
        ? col.format(value)
        : defaultFormat(value, relationData[col.key]);
      return `<td class="cms-td">${formatted}</td>`;
    }).join('\n      ');

    // Render M2M cells for this record
    const recordM2M = manyToManyData.get(id as string | number) ?? [];
    const m2mCells = recordM2M.map((m2m) => {
      const display = m2m.displayValues.length > 0
        ? escapeHtml(m2m.displayValues.join(', '))
        : '<span class="cms-null">—</span>';
      return `<td class="cms-td">${display}</td>`;
    }).join('\n      ');

    const actions: string[] = [];
    if (options.showView) {
      actions.push(html`
        <a href="${options
          .baseUrl}/${id}" class="cms-action cms-action-view">View</a>
      `);
    }
    if (options.showEdit) {
      actions.push(html`
        <a href="${options
          .baseUrl}/${id}/edit" class="cms-action cms-action-edit"
        >Edit</a>
      `);
    }
    if (options.showDelete) {
      const csrfField = options.csrfToken
        ? `<input type="hidden" name="__cms_csrf" value="${
          escapeHtml(options.csrfToken)
        }" />`
        : '';
      actions.push(html`
        <form
          action="${options.baseUrl}/${id}/delete"
          method="POST"
          class="cms-action-form"
        >
          ${raw(csrfField)}
          <button
            type="submit"
            class="cms-action cms-action-delete"
            data-confirm="Delete this record?"
          >
            Delete
          </button>
        </form>
      `);
    }

    const actionsCell = showActions
      ? `<td class="cms-td cms-actions">${actions.join(' ')}</td>`
      : '';

    return `<tr class="cms-tr">
      ${cells}
      ${m2mCells}
      ${actionsCell}
    </tr>`;
  }).join('\n    ');

  return html`
    <table ${attrs({ class: `cms-table ${options.class ?? ''}`.trim() })}>
      <thead>
        <tr>
          ${raw(headerCells)} ${raw(m2mHeaderCells)} ${raw(
            showActions ? '<th class="cms-th cms-th-actions">Actions</th>' : '',
          )}
        </tr>
      </thead>
      <tbody>
        ${raw(rows)}
      </tbody>
    </table>
  `;
}

/**
 * Create list columns from CMSFields
 */
export function fieldsToListColumns(
  fields: CMSField[],
  exclude: string[] = [],
): ListColumn[] {
  return fields
    .filter((f) => !f.hidden && !exclude.includes(f.column.propertyName))
    .map((f) => ({
      key: f.column.propertyName,
      label: f.label,
    }));
}

/**
 * Render a complete list view with header and table
 */
export function listView(
  title: string,
  columns: ListColumn[],
  records: Record<string, unknown>[],
  options: ListViewOptions,
  relationData: Record<string, RelationOption[]> = {},
  manyToManyData: Map<string | number, ManyToManyDisplayData[]> = new Map(),
  cellOverrides: CellOverrides = new Map(),
): string {
  const viewToggleHtml = options.viewToggle
    ? viewToggle(options.viewToggle)
    : '';

  return html`
    <div class="cms-list-view">
      <header class="cms-list-header">
        <h1>${title}</h1>
        <div class="cms-list-actions">
          ${raw(viewToggleHtml)}
          <a href="${options
            .baseUrl}/new" class="cms-btn cms-btn-primary">Create New</a>
        </div>
      </header>
      ${raw(
        listTable(
          columns,
          records,
          options,
          relationData,
          manyToManyData,
          cellOverrides,
        ),
      )}
    </div>
  `;
}
