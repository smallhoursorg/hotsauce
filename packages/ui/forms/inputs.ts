// Form field input renderers by field type

import { attrs, formatFileSize, getSafeUrl, html, raw } from '../html.ts';
import type { CMSField } from '@hotsauce/core';
import {
  FILE_DEFAULT_ACCEPT,
  FILE_DEFAULT_MAX_SIZE,
  isValidFileReference,
} from '@hotsauce/core';

/**
 * An option for a relation select field
 */
export interface RelationOption {
  /** The value (typically the primary key) */
  value: string | number;
  /** The display label */
  label: string;
}

/**
 * Data for a many-to-many relation (used in edit forms)
 */
export interface ManyToManyData {
  /** Form field name (e.g., 'categoryIds') */
  fieldName: string;
  /** Display label (e.g., 'Categories') */
  label: string;
  /** The related table name */
  relatedTable: string;
  /** All available options from the related table */
  options: RelationOption[];
  /** Currently selected values */
  selectedValues: (string | number)[];
}

/**
 * Options for rendering a field input
 */
export interface FieldInputOptions {
  /** Current value of the field */
  value?: unknown;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  class?: string;
  /** HTML id attribute (defaults to field name) */
  id?: string;
  /** Options for relation fields (FK select dropdowns) */
  relationOptions?: RelationOption[];
}

/**
 * Get validation attributes based on column metadata
 */
function getValidationAttrs(field: CMSField): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const col = field.column;

  if (col.notNull && !col.hasDefault) {
    result.required = true;
  }
  if (col.maxLength) {
    result.maxlength = col.maxLength;
  }

  return result;
}

/**
 * Render a text input
 */
export function textInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  return html`
    <input ${attrs({
      type: 'text',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: options.value ?? '',
      class: `cms-input cms-input-text ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      placeholder: field.placeholder,
      ...getValidationAttrs(field),
    })} />
  `;
}

/**
 * Render a textarea for long text
 */
export function textareaInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  const value = options.value ?? '';
  return html`
    <textarea ${attrs({
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      class: `cms-input cms-textarea ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      placeholder: field.placeholder,
      rows: 5,
      ...getValidationAttrs(field),
    })}>${value}</textarea>
  `;
}

/**
 * Render a number input
 */
export function numberInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  return html`
    <input ${attrs({
      type: 'number',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: options.value ?? '',
      class: `cms-input cms-input-number ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      step: field.column.dataType === 'number' ? 'any' : '1',
      ...getValidationAttrs(field),
    })} />
  `;
}

/**
 * Render a checkbox for boolean fields.
 * Includes a hidden input to ensure unchecked state is submitted as 'false'.
 */
export function booleanInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  // Hidden input ensures form submits 'false' when checkbox is unchecked.
  // When checkbox is checked, it overrides with 'true'.
  return html`
    <input type="hidden" name="${field.column.propertyName}" value="false" />
    <input ${attrs({
      type: 'checkbox',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      checked: Boolean(options.value),
      class: `cms-input cms-checkbox ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      value: 'true',
    })} />
  `;
}

/**
 * Render a date input
 */
export function dateInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  let value = options.value;
  if (value instanceof Date) {
    value = value.toISOString().split('T')[0];
  }
  return html`
    <input ${attrs({
      type: 'date',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: value ?? '',
      class: `cms-input cms-input-date ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      ...getValidationAttrs(field),
    })} />
  `;
}

/**
 * Render a datetime-local input
 */
export function datetimeInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  let value = options.value;
  if (value instanceof Date) {
    value = value.toISOString().slice(0, 16);
  }
  return html`
    <input ${attrs({
      type: 'datetime-local',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: value ?? '',
      class: `cms-input cms-input-datetime ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      ...getValidationAttrs(field),
    })} />
  `;
}

/**
 * Render a select dropdown for enum fields
 */
export function selectInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  const enumValues = field.column.enumValues ?? [];
  const currentValue = options.value;
  const isRequired = field.column.notNull && !field.column.hasDefault;

  const optionElements = enumValues.map((val) =>
    html`
      <option ${attrs({
        value: val,
        selected: val === currentValue,
      })}>${val}</option>
    `
  );

  return html`
    <select ${attrs({
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      class: `cms-input cms-select ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      required: isRequired,
    })}>
      ${raw(isRequired ? '' : '<option value="">-- Select --</option>')} ${raw(
        optionElements.join('\n    '),
      )}
    </select>
  `;
}

/**
 * Render a UUID input (readonly text display or text input)
 */
export function uuidInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  // UUIDs are often auto-generated, show as readonly if has value
  const hasValue = options.value !== undefined && options.value !== null &&
    options.value !== '';
  return html`
    <input ${attrs({
      type: 'text',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: options.value ?? '',
      class: `cms-input cms-input-uuid ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      readonly: hasValue && field.column.isPrimaryKey,
      pattern:
        '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      ...getValidationAttrs(field),
    })} />
  `;
}

/**
 * Render a JSON editor (textarea with JSON)
 */
export function jsonInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  let value = options.value;
  if (value !== undefined && value !== null && typeof value !== 'string') {
    value = JSON.stringify(value, null, 2);
  }
  return html`
    <textarea ${attrs({
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      class: `cms-input cms-json ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      rows: 8,
      ...getValidationAttrs(field),
    })}>${value ?? ''}</textarea>
  `;
}

/**
 * Render a hidden input
 */
export function hiddenInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  return html`
    <input ${attrs({
      type: 'hidden',
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      value: options.value ?? '',
    })} />
  `;
}

/**
 * Render a relation select (FK picker)
 */
export function relationInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  const relationOptions = options.relationOptions ?? [];
  const currentValue = options.value != null ? String(options.value) : '';
  const isRequired = field.column.notNull && !field.column.hasDefault;

  // Build option elements
  const optionElements = relationOptions.map((opt) => {
    const selected = String(opt.value) === currentValue;
    return html`
      <option ${attrs({ value: opt.value, selected })}>${opt.label}</option>
    `;
  });

  // Add reference info to help text if available
  const refInfo = field.column.references;
  const placeholder = refInfo
    ? `-- Select ${refInfo.table} --`
    : '-- Select --';

  return html`
    <select ${attrs({
      name: field.column.propertyName,
      id: options.id ?? field.column.propertyName,
      class: `cms-input cms-select cms-relation ${options.class ?? ''}`.trim(),
      disabled: options.disabled,
      required: isRequired,
    })}>
      <option value="">${placeholder}</option>
      ${raw(optionElements.join('\n    '))}
    </select>
  `;
}

/**
 * Options for many-to-many checkbox list
 */
export interface ManyToManyInputOptions {
  /** Field name for the form (e.g., 'categoryIds') */
  name: string;
  /** HTML id attribute */
  id?: string;
  /** Display label */
  label: string;
  /** All available options */
  options: RelationOption[];
  /** Currently selected values */
  selectedValues?: (string | number)[];
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  class?: string;
}

/**
 * Render a checkbox list for many-to-many relations
 */
export function checkboxListInput(
  inputOptions: ManyToManyInputOptions,
): string {
  const { name, label, options, selectedValues = [], disabled = false } =
    inputOptions;
  const id = inputOptions.id ?? name;
  const selectedSet = new Set(selectedValues.map((v) => String(v)));

  if (options.length === 0) {
    return html`
      <div class="cms-checkbox-list cms-checkbox-list-empty">
        <p class="cms-text-muted">No ${label.toLowerCase()} available.</p>
      </div>
    `;
  }

  const checkboxes = options.map((opt, index) => {
    const checked = selectedSet.has(String(opt.value));
    const inputId = `${id}-${index}`;

    return html`
      <label ${attrs({ class: 'cms-checkbox-item', for: inputId })}>
        <input ${attrs({
          type: 'checkbox',
          name,
          id: inputId,
          value: opt.value,
          checked,
          disabled,
          class: 'cms-checkbox',
        })} />
        <span class="cms-checkbox-label">${opt.label}</span>
      </label>
    `;
  });

  return html`
    <div ${attrs({
      class: `cms-checkbox-list ${inputOptions.class ?? ''}`.trim(),
    })}>
      ${raw(checkboxes.join('\n  '))}
    </div>
  `;
}

/**
 * Render a single many-to-many field with label and checkbox list.
 * Used by both edit view and grid panel to ensure consistent rendering.
 */
export function manyToManyField(m2m: ManyToManyData): string {
  return html`
    <div class="cms-field">
      <label class="cms-label">${m2m.label}</label>
      ${raw(checkboxListInput({
        name: m2m.fieldName,
        label: m2m.label,
        options: m2m.options,
        selectedValues: m2m.selectedValues,
      }))}
    </div>
  `;
}

/**
 * Render a file upload input
 *
 * Shows:
 * - Current file info if a file is already uploaded
 * - File input for uploading a new file
 *
 * Note: Form must use enctype="multipart/form-data" for file uploads.
 * TODO: Add "remove file" checkbox in future version.
 */
export function fileInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  const cmsOptions = field.column.cmsOptions ?? {};
  const fileOptions = cmsOptions.file;
  const fileConfig: Record<string, unknown> = fileOptions === true
    ? {}
    : fileOptions && typeof fileOptions === 'object'
    ? fileOptions as Record<string, unknown>
    : {};
  const accept = typeof fileConfig.accept === 'string'
    ? fileConfig.accept
    : FILE_DEFAULT_ACCEPT;
  const maxSize = typeof fileConfig.maxSize === 'number'
    ? fileConfig.maxSize
    : FILE_DEFAULT_MAX_SIZE;
  const maxSizeKb = Math.round(maxSize / 1000);
  const propertyName = field.column.propertyName;

  // Check if there's an existing file
  const existingFile = options.value;
  const hasExistingFile = isValidFileReference(existingFile);

  // Show current file if exists (with image preview for images)
  let currentFileDisplay = '';
  if (hasExistingFile) {
    const isImage = existingFile.contentType.startsWith('image/');
    const isSvg = existingFile.contentType === 'image/svg+xml';
    const previewSvg = fileConfig.previewSvg === true;
    const shouldRenderImagePreview = isImage && (!isSvg || previewSvg);
    // For images, determine preview URL:
    // 1. Direct URL (e.g., from external storage with public URLs)
    // 2. Base64 data (inline storage)
    let previewUrl: string | null = null;
    const safeUrl = existingFile.url ? getSafeUrl(existingFile.url) : null;
    if (safeUrl) {
      previewUrl = safeUrl;
    } else if (existingFile.data) {
      previewUrl =
        `data:${existingFile.contentType};base64,${existingFile.data}`;
    }
    const imagePreview = shouldRenderImagePreview && previewUrl
      ? html`
        <img src="${previewUrl}" alt="${existingFile
          .filename}" class="cms-file-preview" />
      `
      : '';
    // Delete button - sets hidden field that signals file removal.
    // Not rendered for disabled (read-only) fields. Note the server only
    // enforces this for columns excluded by column policy (writableColumns);
    // `$cms({ readOnly: true })` is a UI-level hint, not a server guard.
    const deleteButton = !field.column.notNull && !options.disabled
      ? html`
        <button
          type="submit"
          name="_clear_${propertyName}"
          value="1"
          class="cms-btn cms-btn-danger cms-btn-small"
        >
          Delete
        </button>
      `
      : '';
    currentFileDisplay = html`
      <div class="cms-file-current">
        ${raw(imagePreview)}
        <div class="cms-file-info">
          <span class="cms-file-icon">${isImage ? '🖼️' : '📄'}</span>
          <span class="cms-file-name">${existingFile.filename}</span>
          <span class="cms-file-size">(${formatFileSize(
            existingFile.size,
          )})</span>
          ${raw(deleteButton)}
        </div>
      </div>
    `;
  }

  const isRequired = field.column.notNull && !field.column.hasDefault &&
    !hasExistingFile;

  return html`
    <div class="cms-file-input-wrapper">
      ${raw(currentFileDisplay)}
      <input ${attrs({
        type: 'file',
        name: propertyName,
        id: options.id ?? propertyName,
        class: `cms-input cms-input-file ${options.class ?? ''}`.trim(),
        disabled: options.disabled,
        accept,
        required: isRequired,
      })} />
      <p class="cms-file-help">
        ${hasExistingFile
          ? 'Upload new file to replace. '
          : ''}Max size: ${maxSizeKb}KB. Accepted: ${accept}
      </p>
    </div>
  `;
}

/**
 * Render the appropriate input for a CMS field
 */
export function renderFieldInput(
  field: CMSField,
  options: FieldInputOptions = {},
): string {
  // Hidden fields
  if (field.hidden) {
    return hiddenInput(field, options);
  }

  // Readonly fields shown as disabled
  if (field.readOnly) {
    options = { ...options, disabled: true };
  }

  switch (field.fieldType) {
    case 'text':
      return textInput(field, options);
    case 'textarea':
    case 'richtext':
      return textareaInput(field, options);
    case 'number':
      return numberInput(field, options);
    case 'boolean':
      return booleanInput(field, options);
    case 'date':
      return dateInput(field, options);
    case 'datetime':
      return datetimeInput(field, options);
    case 'select':
      return selectInput(field, options);
    case 'uuid':
      return uuidInput(field, options);
    case 'json':
      return jsonInput(field, options);
    case 'relation':
      return relationInput(field, options);
    case 'array':
      return jsonInput(field, options); // Arrays as JSON for now
    case 'file':
      return fileInput(field, options);
    default:
      return textInput(field, options);
  }
}
