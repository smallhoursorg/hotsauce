/**
 * Picker selection contract shared by the CMS picker grid (server) and the
 * ImagePickerField (client). Kept free of React so it can be unit-tested and
 * reused by custom field implementations.
 *
 * @module
 */

/** `type` of the postMessage the picker grid sends to its parent window. */
export const PICKER_MESSAGE_TYPE = 'cms:media-selected';

/**
 * Selected image value stored in Puck data.
 * Stores only identifiers — URLs are constructed at render time.
 *
 * Works with any table containing image files (e.g., media, photos, avatars).
 */
export type SelectedImage = {
  /** Primary key from the table */
  id: string | number;
  /** Table name (e.g. 'media', 'photos', 'avatars') */
  table: string;
  /** File column property name (e.g. 'file', 'coverImage') */
  column: string;
  /** Alt text seeded from the record (can be overridden per usage) */
  alt?: string;
  /** Original filename (display only) */
  filename?: string;
};

/**
 * Build a {@link SelectedImage} from a picker postMessage payload, or return
 * `null` if the payload is not a usable selection.
 *
 * The primary key is taken from the message's `id`, which the picker grid
 * fills from the record's real primary-key column (whatever it is called), so
 * tables whose PK is not literally `id` work. `record.id` is accepted as a
 * fallback for older picker pages that only carried the PK inside `record`.
 * The `column` is always the server's, never the caller's, so it reflects the
 * real file column.
 */
export function selectionFromPickerMessage(
  data: unknown,
  defaults: { table?: string; altField?: string } = {},
): SelectedImage | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== PICKER_MESSAGE_TYPE) return null;

  const column = typeof msg.column === 'string' && msg.column.length > 0
    ? msg.column
    : null;
  if (!column) return null;

  const record = msg.record && typeof msg.record === 'object'
    ? msg.record as Record<string, unknown>
    : {};

  // Validate id shape defensively (number or non-empty string) rather than
  // persisting a garbage value.
  const id = msg.id ?? record.id;
  const isValidId = typeof id === 'number' ||
    (typeof id === 'string' && id.length > 0);
  if (!isValidId) return null;

  const file = record[column];
  const filename = file && typeof file === 'object' &&
      typeof (file as { filename?: unknown }).filename === 'string'
    ? (file as { filename: string }).filename
    : '';
  const alt = defaults.altField ? record[defaults.altField] : undefined;

  return {
    id: id as string | number,
    table: (typeof msg.table === 'string' && msg.table) || defaults.table ||
      '',
    column,
    alt: typeof alt === 'string' ? alt : '',
    filename,
  };
}
