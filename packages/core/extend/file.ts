// Runtime utilities for file references in CMS-managed storage.

import type { FileReference } from './types.ts';

/**
 * Runtime check for valid FileReference shape.
 * Defensive check for data that may have been inserted outside CMS.
 */
export function isValidFileReference(value: unknown): value is FileReference {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.filename === 'string' &&
    typeof obj.contentType === 'string' &&
    typeof obj.size === 'number'
  );
}

/**
 * Generate the expected key prefix for CMS-managed file storage.
 * All storage plugins (S3, fs, R2, etc.) should use this format.
 *
 * Format: {table}/{column}/{recordId}/
 *
 * `column` is the Drizzle property name (e.g. `coverImage`), the same
 * identifier the CMS uses in URLs, policies and plugin contexts — not the
 * database column name.
 *
 * @example
 * ```ts
 * const prefix = getFileKeyPrefix('posts', 'image', 42);
 * // Returns: 'posts/image/42/'
 * ```
 */
export function getFileKeyPrefix(
  table: string,
  column: string,
  recordId: string | number,
): string {
  return `${table}/${column}/${recordId}/`;
}

/**
 * Validate that a file reference key was minted for the correct record.
 * Prevents cross-record key tampering attacks where a user submits
 * a key generated for a different record.
 *
 * @example
 * ```ts
 * // Key from presign: 'posts/image/42/abc123-photo.jpg'
 * isValidFileKey('posts/image/42/abc123-photo.jpg', 'posts', 'image', 42); // true
 * isValidFileKey('posts/image/99/abc123-photo.jpg', 'posts', 'image', 42); // false
 * ```
 */
export function isValidFileKey(
  key: string,
  table: string,
  column: string,
  recordId: string | number,
): boolean {
  return key.startsWith(getFileKeyPrefix(table, column, recordId));
}
