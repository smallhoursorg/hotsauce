// Grid view - thumbnail grid for tables with visual content

import {
  attrs,
  escapeHtml,
  formatFileSize,
  getSafeUrl,
  html,
  raw,
} from '../html.ts';
import { viewToggle } from '../components/view-toggle.ts';
import type { CMSField } from '@hotsauce/core';
import { typeByExtension } from '@std/media-types';
import { isValidFileReference } from '@hotsauce/core';
import {
  type FieldUIOverride,
  form,
  type RelationOption,
} from '../forms/form.ts';
import { type ManyToManyData, manyToManyField } from '../forms/inputs.ts';

/**
 * Options for grid view
 */
export interface GridViewOptions {
  /** Base URL for record links (e.g., /admin/media) */
  baseUrl: string;
  /** Primary key field name (default: id) */
  primaryKey?: string;
  /** The thumbnail field */
  thumbnailField: CMSField;
  /** Current view mode for toggle state */
  currentView: 'grid' | 'table';
  /** Current URL path + query for building toggle links */
  currentUrl: string;
  /** Currently selected record ID (for RHS panel) */
  selectedId?: string | number;
  /** Picker mode: minimal UI, click posts message to parent instead of navigating */
  pickerMode?: boolean;
  /** Table name (required for picker mode postMessage) */
  tableName?: string;
}

/**
 * Thumbnail data resolved for a record.
 * Pre-computed by the CMS handler so the UI doesn't need storage logic.
 */
export interface GridThumbnail {
  /** Record primary key */
  id: string | number;
  /** Resolved thumbnail URL (presigned, public, or data: URI) */
  thumbnailUrl: string | null;
  /** Display label (filename, alt text, or record identifier) */
  label: string;
  /** Full record data (for picker mode postMessage) */
  record?: Record<string, unknown>;
}

/**
 * Data needed to render the RHS detail panel for a selected grid item.
 */
export interface GridPanelData {
  /** Record ID */
  id: string | number;
  /** Resolved thumbnail URL for larger preview */
  thumbnailUrl: string | null;
  /** File metadata (for file-type thumbnail columns) */
  fileMeta?: { filename: string; contentType: string; size: number };
  /** CMS fields to render in the edit form */
  fields: CMSField[];
  /** Current field values */
  values: Record<string, unknown>;
  /** Validation errors per field */
  errors: Record<string, string>;
  /** FK relation options for select dropdowns */
  relationData: Record<string, RelationOption[]>;
  /** Many-to-many data for checkbox lists */
  manyToManyData: ManyToManyData[];
  /** Plugin-provided field UI overrides */
  fieldOverrides: Record<string, FieldUIOverride>;
  /** CSRF token for form */
  csrfToken: string;
  /** Source token for form */
  sourceToken: string;
  /** Whether form needs multipart encoding */
  multipart?: boolean;
  /** URL to return to after save/delete */
  returnUrl: string;
}

/**
 * Get image MIME type from a URL path based on extension.
 * Uses @std/media-types for reliable MIME type inference.
 * Returns null if not an image URL.
 */
function getImageMimeType(url: string): string | null {
  // Strip query string and fragment
  const path = url.split('?')[0]?.split('#')[0] ?? '';
  // Extract extension (e.g., ".jpg" → "jpg")
  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  if (!extMatch) return null;
  const ext = extMatch[1];
  if (!ext) return null;
  // Get MIME type from extension
  const mimeType = typeByExtension(ext);
  if (!mimeType?.startsWith('image/')) return null;
  return mimeType;
}

/**
 * Resolve a thumbnail URL from a record value based on field type.
 * For FileReference: uses fileUrl (presigned) → url → data: URI.
 * For plain strings: uses the value directly.
 * SVG files are skipped by default (XSS defense-in-depth) unless previewSvg is true.
 */
export function resolveThumbnailUrl(
  value: unknown,
  fieldType: string,
  fileUrl?: string,
  options?: { previewSvg?: boolean },
): string | null {
  if (fieldType === 'file') {
    if (!isValidFileReference(value)) return null;
    // Only show images in thumbnail grid
    if (!value.contentType.startsWith('image/')) return null;
    // Skip SVG unless explicitly opted-in (matches fileInput behavior)
    const isSvg = value.contentType === 'image/svg+xml';
    if (isSvg && !options?.previewSvg) return null;
    // Try fileUrl first, but fall back if it fails validation
    if (fileUrl) {
      const safeFileUrl = getSafeUrl(fileUrl);
      if (safeFileUrl) return safeFileUrl;
    }
    const safeUrl = value.url ? getSafeUrl(value.url) : null;
    if (safeUrl) return safeUrl;
    if (value.data) {
      return `data:${value.contentType};base64,${value.data}`;
    }
    return null;
  }
  // Plain URL string - only accept if it looks like an image URL
  if (typeof value === 'string' && value.length > 0) {
    const mimeType = getImageMimeType(value);
    if (!mimeType) return null;
    // Skip SVG unless explicitly opted-in (XSS defense-in-depth)
    if (mimeType === 'image/svg+xml' && !options?.previewSvg) return null;
    return getSafeUrl(value);
  }
  return null;
}

/**
 * Get a display label for a grid item from the record.
 * Tries: filename from FileReference, or the record ID.
 */
export function getGridItemLabel(
  record: Record<string, unknown>,
  thumbnailField: CMSField,
  primaryKey: string,
): string {
  const value = record[thumbnailField.column.propertyName];

  // For file fields, use filename
  if (thumbnailField.fieldType === 'file' && isValidFileReference(value)) {
    return value.filename;
  }

  // Fall back to record ID
  const id = record[primaryKey];
  return id != null ? String(id) : '';
}

/**
 * Render the thumbnail grid
 */
export function gridItems(
  records: Record<string, unknown>[],
  thumbnails: GridThumbnail[],
  options: GridViewOptions,
): string {
  const emptyMessage = 'No records found.';

  if (records.length === 0) {
    return html`
      <div class="cms-empty">
        <p>${emptyMessage}</p>
        ${options.pickerMode ? '' : raw(
          `<a href="${
            escapeHtml(options.baseUrl)
          }/new" class="cms-btn cms-btn-primary">Create New</a>`,
        )}
      </div>
    `;
  }

  const items = thumbnails.map((thumb) => {
    const thumbnailHtml = thumb.thumbnailUrl
      ? `<img src="${escapeHtml(thumb.thumbnailUrl)}" alt="${
        escapeHtml(thumb.label)
      }" class="cms-grid-thumb" loading="lazy" />`
      : '<div class="cms-grid-placeholder">No image</div>';

    // Picker mode: render button with data attributes for postMessage
    if (options.pickerMode) {
      return html`
        <button
          type="button"
          class="cms-grid-item cms-grid-picker-item"
          data-picker-id="${thumb.id}"
          data-picker-table="${options.tableName ?? ''}"
          data-picker-column="${options.thumbnailField.column.propertyName}"
          data-picker-record="${JSON.stringify(thumb.record ?? {})}"
        >
          ${raw(thumbnailHtml)}
          <span class="cms-grid-label">${thumb.label}</span>
        </button>
      `;
    }

    // Normal mode: link to ?selected=<id> for panel
    const selectUrl = new URL(options.currentUrl, 'http://localhost');
    selectUrl.searchParams.set('selected', String(thumb.id));
    const href = `${selectUrl.pathname}${selectUrl.search}`;

    const isSelected = options.selectedId !== undefined &&
      String(options.selectedId) === String(thumb.id);
    const selectedClass = isSelected ? ' cms-grid-item-selected' : '';

    return html`
      <a ${attrs({ href, class: `cms-grid-item${selectedClass}` })}>
        ${raw(thumbnailHtml)}
        <span class="cms-grid-label">${thumb.label}</span>
      </a>
    `;
  }).join('\n');

  return `<div class="cms-grid">${items}</div>`;
}

/**
 * Render the RHS detail/edit panel for a selected grid item.
 */
export function gridDetailPanel(
  panel: GridPanelData,
  options: GridViewOptions,
): string {
  // Close button: link back to grid without ?selected
  const closeUrl = new URL(options.currentUrl, 'http://localhost');
  closeUrl.searchParams.delete('selected');
  const closeHref = `${closeUrl.pathname}${closeUrl.search}`;

  // Thumbnail preview
  const altText = panel.fileMeta?.filename
    ? `Preview of ${panel.fileMeta.filename}`
    : `Preview for record ${panel.id}`;
  const previewHtml = panel.thumbnailUrl
    ? `<img src="${escapeHtml(panel.thumbnailUrl)}" alt="${
      escapeHtml(altText)
    }" class="cms-panel-preview" />`
    : '<div class="cms-panel-preview-placeholder">No image</div>';

  // File metadata
  let metaHtml = '';
  if (panel.fileMeta) {
    const sizeStr = formatFileSize(panel.fileMeta.size);
    metaHtml = html`
      <dl class="cms-panel-meta">
        <dt>Filename</dt>
        <dd>${panel.fileMeta.filename}</dd>
        <dt>Type</dt>
        <dd>${panel.fileMeta.contentType}</dd>
        <dt>Size</dt>
        <dd>${sizeStr}</dd>
      </dl>
    `;
  }

  // Edit form — reuses the standard form component
  const formAction = `${options.baseUrl}/${panel.id}`;
  const formHtml = form(
    panel.fields,
    {
      action: formAction,
      method: 'POST',
      submitText: 'Save',
      class: 'cms-panel-form',
      csrfToken: panel.csrfToken,
      sourceToken: panel.sourceToken,
      multipart: panel.multipart,
    },
    panel.values,
    panel.errors,
    panel.relationData,
    // Extra content: __cms_return hidden field + M2M sections
    renderPanelExtraContent(panel),
    panel.fieldOverrides,
  );

  // Delete form
  const deleteAction = `${options.baseUrl}/${panel.id}/delete`;
  const csrfField = `<input type="hidden" name="__cms_csrf" value="${
    escapeHtml(panel.csrfToken)
  }" />`;
  const returnField = `<input type="hidden" name="__cms_return" value="${
    escapeHtml(panel.returnUrl)
  }" />`;

  return html`
    <aside class="cms-grid-panel">
      <div class="cms-panel-header">
        <a ${attrs({
          href: closeHref,
          class: 'cms-panel-close',
          title: 'Close panel',
          'aria-label': 'Close panel',
        })}>✕</a>
      </div>
      ${raw(previewHtml)} ${raw(metaHtml)} ${raw(formHtml)}
      <div class="cms-panel-danger">
        <form action="${deleteAction}" method="POST" class="cms-inline-form">
          ${raw(csrfField)} ${raw(returnField)}
          <button
            type="submit"
            class="cms-btn cms-btn-danger"
            data-confirm="Delete this record?"
          >
            Delete
          </button>
        </form>
      </div>
    </aside>
  `;
}

/** Render extra hidden fields and M2M sections for the panel form */
function renderPanelExtraContent(panel: GridPanelData): string {
  const parts: string[] = [];
  // __cms_return hidden field so update redirects back to grid
  parts.push(
    `<input type="hidden" name="__cms_return" value="${
      escapeHtml(panel.returnUrl)
    }" />`,
  );

  // Render M2M checkbox sections using shared helper
  for (const m2m of panel.manyToManyData) {
    parts.push(manyToManyField(m2m));
  }

  return parts.join('\n');
}

/**
 * Render a complete grid view with header, toggle, and grid
 */
export function gridView(
  title: string,
  records: Record<string, unknown>[],
  thumbnails: GridThumbnail[],
  options: GridViewOptions,
  panel?: GridPanelData,
): string {
  const toggle = viewToggle({
    currentView: options.currentView,
    currentUrl: options.currentUrl,
  });
  const gridContent = gridItems(records, thumbnails, options);
  const panelHtml = panel ? gridDetailPanel(panel, options) : '';
  const layoutClass = panel ? ' cms-grid-panel-layout' : '';

  return html`
    <div class="cms-list-view">
      <header class="cms-list-header">
        <h1>${title}</h1>
        <div class="cms-list-actions">
          ${raw(toggle)}
          <a href="${options
            .baseUrl}/new" class="cms-btn cms-btn-primary">Create New</a>
        </div>
      </header>
      <div ${attrs({ class: `cms-grid-content${layoutClass}` })}>
        <div class="cms-grid-main">
          ${raw(gridContent)}
        </div>
        ${raw(panelHtml)}
      </div>
    </div>
  `;
}

/**
 * Render a minimal picker grid view (no header, toggle, or create button)
 */
export function pickerGridView(
  title: string,
  records: Record<string, unknown>[],
  thumbnails: GridThumbnail[],
  options: GridViewOptions,
): string {
  const gridContent = gridItems(records, thumbnails, options);

  return html`
    <div class="cms-picker-view">
      <header class="cms-picker-header">
        <h2>${title}</h2>
      </header>
      <div class="cms-grid-content">
        <div class="cms-grid-main">
          ${raw(gridContent)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Script for picker mode postMessage handling.
 * Clicks on picker items post message to parent window.
 */
export const pickerScript: string = `
(function() {
  'use strict';
  
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!(target instanceof Element)) return;
    var item = target.closest('.cms-grid-picker-item');
    if (!item) return;
    e.preventDefault();
    // dataset values are always strings; read record.id for the typed PK.
    var id = item.dataset.pickerId;
    var table = item.dataset.pickerTable;
    var column = item.dataset.pickerColumn;
    var recordJson = item.dataset.pickerRecord || '{}';
    var record;
    try {
      record = JSON.parse(recordJson);
    } catch (err) {
      record = {};
    }
    
    // Post message to parent (Puck editor iframe parent)
    // Include resolved URL and column separately; column is the server-authoritative
    // file column name so callers don't have to duplicate schema knowledge.
    window.parent.postMessage({
      type: 'cms:media-selected',
      table: table,
      column: column,
      id: id,
      record: record
    }, window.location.origin);
  });
})();
`;

/**
 * Render a minimal picker page layout (no sidebar, external script).
 *
 * Uses a plain template literal (not the html`` tag) because `renderedHtml` is
 * pre-rendered — interpolating it through html`` would double-escape it.
 * Dynamic values (title, URLs) are escaped manually via escapeHtml().
 */
export function pickerLayout(
  renderedHtml: string,
  options: {
    title: string;
    stylesheetUrl?: string;
    scriptUrl?: string;
  },
): string {
  const stylesheetUrl = options.stylesheetUrl ?? 'styles.css';
  const scriptTag = options.scriptUrl
    ? `<script src="${escapeHtml(options.scriptUrl)}"></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)} - Picker</title>
  <link rel="stylesheet" href="${escapeHtml(stylesheetUrl)}">
</head>
<body class="cms-picker-body">
  ${renderedHtml}
  ${scriptTag}
</body>
</html>`;
}
