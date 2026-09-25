/**
 * Filesystem Storage Plugin for HotSauce CMS
 *
 * Stores uploaded files on the local filesystem (or any injected
 * {@link FileSystemAdapter}) and serves them from the application server
 * itself — no nginx/CDN required. A static file server can still be placed in
 * front via `publicBaseUrl`.
 *
 * Unlike the S3 plugin, the browser cannot write directly to the server's disk,
 * so the upload and serving routes live inside the CMS and are authorised by
 * short-lived HMAC tokens (see `signing.ts`).
 *
 * ## Runtime
 *
 * Filesystem access is feature-detected at call time (Deno or Node 20+/Bun),
 * consistent with `getEnv()` in `packages/cms/runtime-compat.ts`. No `Deno.*`
 * symbol is referenced at module top-level, so the package stays
 * runtime-agnostic per `AGENTS.md`.
 *
 * @example
 * ```ts
 * import { createFsStoragePlugin } from '@hotsauce/plugins/fs-storage';
 *
 * const handler = createCmsHandler({
 *   db, schema, basePath: '/admin',
 *   plugins: [
 *     createFsStoragePlugin({
 *       basePath: '/admin',
 *       rootDir: './uploads',
 *       signingSecret: process.env.CMS_CSRF_SECRET!,
 *     }),
 *   ],
 *   storage: 'fs',
 * });
 * ```
 *
 * @module
 */

import type { InProcessPluginConfig } from '@hotsauce/cms';
import type {
  DeleteContext,
  PresignContext,
  PresignResult,
  SignDownloadContext,
  StorageProvider,
} from '@hotsauce/cms';
import { getFileKeyPrefix, isValidFileKey } from '@hotsauce/core';
import { typeByExtension } from '@std/media-types';
import { attrs, html, raw } from '@hotsauce/ui';
import {
  contentDispositionHeader,
  getEnv,
  jsonResponse,
  matchesAcceptPattern,
} from '@hotsauce/cms';
import type {
  FileSystemAdapter,
  FsStoragePluginOptions,
  ResolvedFsOptions,
} from './types.ts';
import { assertSafeKey, createDiskFsAdapter } from './adapter.ts';
import { signToken, verifyToken } from './signing.ts';
import { UPLOAD_CSS } from './upload-styles.ts';
import { UPLOAD_JS } from './upload-script.ts';

// Re-export types for convenience
export type { FileSystemAdapter, FsStoragePluginOptions } from './types.ts';
export type { DiskFsAdapterOptions } from './adapter.ts';
export {
  assertSafeKey,
  createDiskFsAdapter,
  createMemoryFsAdapter,
  keyToPath,
} from './adapter.ts';
export { signToken, verifyToken } from './signing.ts';

/** Default max file size for filesystem uploads: 10MB. Set maxSize: 0 in $cms() to disable. */
export const FS_DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/**
 * Default upload-route body cap. The file is streamed raw (no base64), so this
 * is a plain byte cap sized to the 10MB default max file size plus a little
 * headroom.
 */
const FS_DEFAULT_MAX_UPLOAD_BYTES = 11 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Safely serialize a value for embedding in <script type="application/json">. */
function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function resolveFileConfig(
  fieldConfig: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!fieldConfig) return null;
  const fileConfig = fieldConfig.file;

  if (fileConfig === true) {
    return {};
  }
  if (fileConfig && typeof fileConfig === 'object') {
    return fileConfig as Record<string, unknown>;
  }
  return null;
}

/**
 * Validate an upload request against column $cms() options.
 * Returns `{ error: string }` if invalid, `null` if valid.
 *
 * Mirrors the S3 plugin's `validatePresignRequest` (and the multipart check in
 * `packages/cms/http.ts`): applies FS_DEFAULT_MAX_SIZE (10MB) unless an explicit
 * maxSize is set, cross-validates the claimed content type against the file
 * extension, and enforces the `accept` pattern.
 */
export function validatePresignRequest(
  body: { filename: string; contentType: string; size: number },
  fieldConfig: Record<string, unknown> | undefined,
): { error: string } | null {
  const normalizedConfig = resolveFileConfig(fieldConfig);
  if (!normalizedConfig) return null;

  const maxSize = typeof normalizedConfig.maxSize === 'number'
    ? normalizedConfig.maxSize
    : FS_DEFAULT_MAX_SIZE;
  if (maxSize > 0 && body.size > maxSize) {
    const label = maxSize >= 1_048_576
      ? `${Math.round(maxSize / 1_048_576)}MB`
      : `${Math.round(maxSize / 1024)}KB`;
    return { error: `File too large. Maximum size is ${label}.` };
  }

  // Cross-validate claimed content type against file extension.
  const extMatch = body.filename.match(/\.[^.]+$/);
  if (extMatch) {
    const expectedType = typeByExtension(extMatch[0]!.toLowerCase());
    if (!expectedType) {
      return { error: `Unrecognised file extension: ${extMatch[0]}` };
    }
    if (body.contentType && body.contentType.toLowerCase() !== expectedType) {
      return {
        error:
          `Content type mismatch: file extension suggests ${expectedType}, but got ${body.contentType}`,
      };
    }
  }

  const accept = typeof normalizedConfig.accept === 'string'
    ? normalizedConfig.accept
    : undefined;
  if (accept && !matchesAcceptPattern(body.contentType, accept)) {
    return { error: `Invalid file type. Accepted: ${accept}` };
  }

  return null;
}

/**
 * Generate a unique object key for uploads.
 *
 * Format: {table}/{column}/{recordId}/{uuid}-{filename}
 * (`column` is the Drizzle property name, as in every CMS URL.)
 *
 * Uses the shared prefix from core so the CMS download path's key re-validation
 * (`isValidFileKey`) accepts it. Every upload produces a globally unique key.
 */
function generateObjectKey(
  table: string,
  column: string,
  recordId: string,
  filename: string,
): string {
  const uuid = crypto.randomUUID();
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${getFileKeyPrefix(table, column, recordId)}${uuid}-${safeFilename}`;
}

/** Build the relative serving URL path for a key, segment-encoded. */
function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

// ─────────────────────────────────────────────────────────────
// Storage Provider
// ─────────────────────────────────────────────────────────────

function createStorageProvider(options: ResolvedFsOptions): StorageProvider {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  return {
    id: options.storageId,
    kind: 'custom',

    /**
     * Mint a signed, single-use upload URL pointing back at the plugin's own
     * `_upload` route. The browser POSTs the raw file bytes there; the route
     * verifies the token and streams them to disk via the adapter.
     */
    presignUpload(ctx: PresignContext): Promise<PresignResult> {
      const key = generateObjectKey(
        ctx.table,
        ctx.column,
        ctx.recordId!,
        ctx.filename,
      );

      // The token binds key/size/record AND content type. `_upload` rejects a
      // request whose `Content-Type` header doesn't match `contentType` here —
      // the same guarantee S3's signed-header PUT gives, enforced at our own
      // route instead of the bucket. The declared type is also cross-checked
      // against the extension/accept list at presign (`validatePresignRequest`).
      return signToken({
        kind: 'upload',
        table: ctx.table,
        column: ctx.column,
        recordId: ctx.recordId!,
        key,
        size: ctx.size,
        contentType: ctx.contentType,
        exp: nowSeconds() + options.expirySeconds,
      }, options.signingSecret).then((token) => ({
        key,
        upload: {
          method: 'POST',
          url: `${options.basePath}/fs-storage/_upload?token=${
            encodeURIComponent(token)
          }`,
          // The client must echo this exact `Content-Type` on the upload POST
          // (it is checked against the token).
          headers: {
            'Content-Type': ctx.contentType || 'application/octet-stream',
          },
        },
      }));
    },

    /**
     * Return an absolute download URL.
     * - With `publicBaseUrl`: `${publicBaseUrl}/${key}` (served by a static file
     *   server — bypasses CMS policies; see README security notes).
     * - Otherwise: an absolute, token-signed `_serve` URL on this origin that
     *   streams the bytes. The CMS `/files/` route requires an absolute http(s)
     *   URL and 302-redirects to it.
     */
    async signDownloadUrl(ctx: SignDownloadContext): Promise<string> {
      // Core's isValidFileKey only checks the key prefix, so a persisted key
      // could still smuggle `..` segments; reject here so neither branch ever
      // signs or links a traversal path. (The caller treats a throw as a
      // generic serve failure.)
      assertSafeKey(ctx.key);
      if (options.publicBaseUrl) {
        return `${options.publicBaseUrl.replace(/\/+$/, '')}/${
          encodeKeyPath(ctx.key)
        }`;
      }

      // Derive the origin to make an absolute URL (handleFileServing rejects
      // relative paths).
      let origin: string | undefined;
      if (ctx.request) {
        try {
          origin = new URL(ctx.request.url).origin;
        } catch { /* fall through */ }
      }
      if (!origin) {
        throw new Error(
          'fs-storage: cannot build an absolute download URL — set publicBaseUrl or ensure the request is available',
        );
      }

      const token = await signToken({
        kind: 'download',
        key: ctx.key,
        filename: ctx.filename,
        exp: nowSeconds() + options.expirySeconds,
      }, options.signingSecret);

      return `${origin}${options.basePath}/fs-storage/_serve?token=${
        encodeURIComponent(token)
      }`;
    },

    /** Delete an object from storage. */
    deleteObject(ctx: DeleteContext): Promise<void> {
      assertSafeKey(ctx.key);
      return options.fs.delete(ctx.key);
    },

    /** List objects under a key prefix (for orphan cleanup). */
    listObjects(
      prefix: string,
    ): Promise<Array<{ key: string; lastModified: Date; size: number }>> {
      return options.fs.list(prefix);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Plugin Factory
// ─────────────────────────────────────────────────────────────

/**
 * Create a filesystem storage plugin for the CMS.
 *
 * Provides:
 * - A self-hosted upload route (signed-token authorised) that writes to disk
 * - A self-hosted serving route that streams bytes (attachment + nosniff + CSP)
 * - A standalone upload page + "Upload via filesystem" links on edit forms
 * - `deleteObject` / `listObjects` for orphan cleanup
 *
 * @param pluginOptions - Plugin configuration
 * @returns Plugin configuration to pass to createCmsHandler
 */
export function createFsStoragePlugin(
  pluginOptions: FsStoragePluginOptions,
): InProcessPluginConfig {
  const signingSecret = pluginOptions.signingSecret ??
    getEnv('CMS_CSRF_SECRET');
  if (!signingSecret || signingSecret.length < 16) {
    throw new Error(
      'fs-storage: signingSecret is required (>= 16 chars). Pass it explicitly or set CMS_CSRF_SECRET.',
    );
  }

  let fs: FileSystemAdapter;
  if (pluginOptions.fs) {
    fs = pluginOptions.fs;
  } else {
    // The default disk adapter maps keys onto `rootDir`. An empty/whitespace
    // rootDir would resolve keys to `/${key}` (the filesystem root), so reject
    // it with a clear configuration error rather than writing under `/`.
    const rootDir = pluginOptions.rootDir;
    if (typeof rootDir !== 'string' || rootDir.trim() === '') {
      throw new Error(
        'fs-storage: rootDir is required (a non-empty directory path) when no custom fs adapter is provided.',
      );
    }
    fs = createDiskFsAdapter(rootDir, {
      symlinkContainment: pluginOptions.symlinkContainment,
    });
  }

  const options: ResolvedFsOptions = {
    storageId: pluginOptions.storageId ?? 'fs',
    basePath: pluginOptions.basePath,
    signingSecret,
    publicBaseUrl: pluginOptions.publicBaseUrl,
    expirySeconds: pluginOptions.expirySeconds ?? 900,
    maxUploadBytes: pluginOptions.maxUploadBytes ?? FS_DEFAULT_MAX_UPLOAD_BYTES,
    fs,
  };

  const storageProvider = createStorageProvider(options);

  return {
    name: 'fs-storage',
    description: 'Filesystem storage for file uploads',
    storageProvider,

    filter: (ctx) => {
      if (ctx.hookType === 'ui:renderField') return true;
      if (ctx.hookType === 'route') return true;
      return false;
    },

    hooks: {
      ui: {
        /**
         * Render file field UI for create, edit, and detail pages.
         * - Create: "Save record first" (no recordId yet → no upload path)
         * - Edit: "Upload via filesystem" link + file summary + preview
         * - Detail: file summary + preview (no upload link)
         */
        renderField: (ctx) => {
          if (ctx.field.fieldType !== 'file') return null;

          // Only render for this plugin's storage (respects resolveStorage).
          if (ctx.storageId !== options.storageId) return null;

          if (ctx.view === 'create' || !ctx.recordId) {
            return {
              valueSummary: 'Save this record first to enable file uploads',
            };
          }

          if (ctx.view !== 'edit' && ctx.view !== 'detail') return null;

          let valueSummary = 'No file';
          let fileUrl: string | undefined;
          if (ctx.value && typeof ctx.value === 'object') {
            const file = ctx.value as {
              filename?: string;
              size?: number;
              storage?: string;
              key?: string;
              data?: string;
            };
            if (file.filename) {
              const sizeKb = file.size ? Math.round(file.size / 1024) : 0;
              const storage = file.storage ?? (file.data ? 'db' : 'fs');
              valueSummary = `${file.filename} (${sizeKb}KB, ${storage})`;
              if (file.key || file.data) {
                fileUrl =
                  `${options.basePath}/files/${ctx.table}/${ctx.field.name}/${ctx.recordId}`;
              }
            }
          }

          if (ctx.view === 'detail') {
            return {
              valueSummary,
              ...(fileUrl && { fileUrl }),
            };
          }

          const href =
            `${options.basePath}/fs-storage/${ctx.table}/${ctx.recordId}/${ctx.field.name}`;

          return {
            link: { href, label: 'Upload via filesystem', target: '_blank' },
            valueSummary,
            ...(fileUrl && { fileUrl }),
          };
        },
      },
    },

    routes: [
      // Embedded upload page CSS
      {
        pattern: '_assets/upload.css',
        methods: ['GET'],
        handler: () =>
          new Response(UPLOAD_CSS, {
            headers: { 'Content-Type': 'text/css; charset=utf-8' },
          }),
      },
      // Embedded upload page JS
      {
        pattern: '_assets/upload.js',
        methods: ['GET'],
        handler: () =>
          new Response(UPLOAD_JS, {
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
            },
          }),
      },
      // Upload page (GET /admin/fs-storage/:table/:id/:column)
      {
        pattern: ':table/:id/:column',
        methods: ['GET'],
        handler: (ctx) => {
          const { table, id, column } = ctx.params;
          if (!table || !id || !column) {
            return new Response('Not found', { status: 404 });
          }

          const resolvedFieldConfig = resolveFileConfig(
            ctx.field?.config as Record<string, unknown> | undefined,
          );
          // Only render the upload page for columns explicitly configured as
          // file fields (`$cms({ file: ... })`). Otherwise this URL could be
          // used as an upload entrypoint for arbitrary columns.
          if (!resolvedFieldConfig) {
            return new Response('Not found', { status: 404 });
          }
          const acceptValue = resolvedFieldConfig?.accept;
          const maxSizeValue = resolvedFieldConfig?.maxSize;
          const acceptAttr = typeof acceptValue === 'string'
            ? { accept: acceptValue }
            : {};

          const uploadCssUrl =
            `${options.basePath}/fs-storage/_assets/upload.css`;
          const uploadJsUrl =
            `${options.basePath}/fs-storage/_assets/upload.js`;

          // Validate optional ?return= (aligned with crud.ts:getSafeReturnUrl).
          let returnUrl: string | undefined;
          try {
            const reqUrl = new URL(ctx.requestUrl);
            const returnParam = reqUrl.searchParams.get('return')?.trim();
            if (
              returnParam &&
              (returnParam === options.basePath ||
                returnParam.startsWith(options.basePath + '/')) &&
              !returnParam.includes('://') &&
              !returnParam.startsWith('//') &&
              // deno-lint-ignore no-control-regex
              !/[\x00-\x1f\x7f-\x9f\\]/.test(returnParam) &&
              !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(returnParam)
            ) {
              returnUrl = returnParam;
            }
          } catch { /* ignore malformed URL */ }

          const configJson = safeJsonForHtml({
            basePath: options.basePath,
            table,
            recordId: id,
            column,
            csrfToken: ctx.csrfToken,
            sourceToken: ctx.sourceToken,
            maxSize: typeof maxSizeValue === 'number'
              ? maxSizeValue
              : FS_DEFAULT_MAX_SIZE,
            accept: typeof acceptValue === 'string' ? acceptValue : null,
            ...(returnUrl && { returnUrl }),
          });

          const page = html`
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Upload File - ${table}/${id}/${column}</title>
                <link rel="stylesheet" href="${options.basePath}/styles.css">
                <link rel="stylesheet" href="${uploadCssUrl}">
              </head>
              <body>
                <div class="upload-container">
                  <h1>Upload File</h1>
                  <p>
                    Table: <strong>${table}</strong> | Record: <strong
                    >${id}</strong> | Column: <strong>${column}</strong>
                  </p>

                  <label class="upload-area" id="uploadArea">
                    <input type="file" id="fileInput" ${attrs(acceptAttr)}>
                    <p>Click or drag a file here to upload</p>
                  </label>

                  <p id="uploadHints" class="upload-hints"></p>

                  <div class="progress-bar" id="progressBar">
                    <div class="progress" id="progress"></div>
                  </div>

                  <div class="status" id="status"></div>

                  <div class="file-info" id="fileInfo">
                    <p><strong>File:</strong> <span id="fileName"></span></p>
                    <p><strong>Size:</strong> <span id="fileSize"></span></p>
                    <p><strong>Type:</strong> <span id="fileType"></span></p>
                  </div>

                  <p class="back-link">
                    <a
                      href="${returnUrl ??
                        `${options.basePath}/${table}/${id}/edit`}"
                      class="btn btn-secondary"
                    >← Back</a>
                  </p>
                </div>

                ${raw(
                  `<script type="application/json" id="upload-config">${configJson}</script>`,
                )}
                <script src="${uploadJsUrl}"></script>
              </body>
            </html>
          `;

          return page;
        },
      },
      // Presign endpoint (POST /admin/fs-storage/:table/:id/:column)
      {
        pattern: ':table/:id/:column',
        methods: ['POST'],
        resourceIntensive: true,
        handler: async (ctx) => {
          const { table, id, column } = ctx.params;
          if (!table || !id || !column) {
            return new Response('Not found', { status: 404 });
          }

          let body: { filename: string; contentType: string; size: number };
          try {
            if (!ctx.body) throw new Error('No request body');
            body = JSON.parse(ctx.body);
          } catch {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
          }

          if (
            !body.filename || !body.contentType || typeof body.size !== 'number'
          ) {
            return jsonResponse({ error: 'Missing required fields' }, 400);
          }

          const fieldConfig = ctx.field?.config as
            | Record<string, unknown>
            | undefined;

          // Only mint upload tokens for columns explicitly configured as file
          // fields. Without this, an authenticated user could generate
          // arbitrary on-disk keys for any table/column/id (validatePresignRequest
          // is a no-op when `$cms({ file: ... })` is absent).
          if (!resolveFileConfig(fieldConfig)) {
            return jsonResponse({ error: 'Not a file field' }, 404);
          }

          const validationError = validatePresignRequest(body, fieldConfig);
          if (validationError) {
            return jsonResponse(validationError, 400);
          }

          // Reject up front if the file would exceed the upload route's body
          // cap. Otherwise presign succeeds but `_upload` is later rejected at
          // the cap with an opaque 413. The body is streamed raw, so the cap is
          // compared against the file size directly.
          if (body.size > options.maxUploadBytes) {
            const label = options.maxUploadBytes >= 1_048_576
              ? `${Math.round(options.maxUploadBytes / 1_048_576)}MB`
              : `${Math.round(options.maxUploadBytes / 1024)}KB`;
            return jsonResponse({
              error:
                `File too large for the upload route (max request body ~${label}). Raise maxUploadBytes to accept larger files.`,
            }, 400);
          }

          const presignResult = await storageProvider.presignUpload!({
            request: new Request(ctx.requestUrl),
            user: ctx.user ?? null,
            table,
            column,
            action: 'update',
            recordId: id,
            filename: body.filename,
            contentType: body.contentType,
            size: body.size,
          });

          return jsonResponse({
            storage: options.storageId,
            key: presignResult.key,
            upload: presignResult.upload,
          });
        },
      },
      // Upload sink (POST /admin/fs-storage/_upload?token=...)
      // Receives the raw file bytes as a stream; authorised by the signed
      // upload token only (no :table/:id params, so no record fetch — the token
      // binds everything). `bodyType: 'stream'` hands the body straight through
      // as a byte stream, so the file is written to disk without a base64/text
      // round-trip and is never fully buffered.
      {
        pattern: '_upload',
        methods: ['POST'],
        maxBodySize: options.maxUploadBytes,
        bodyType: 'stream',
        resourceIntensive: true,
        handler: async (ctx) => {
          // Rejections before `fs.put` leave the request body unread; dispatch
          // cancels the unconsumed stream after the handler settles, so early
          // returns can hand back the error Response directly.
          let token: string | null = null;
          try {
            token = new URL(ctx.requestUrl).searchParams.get('token');
          } catch { /* malformed URL */ }
          if (!token) {
            return jsonResponse({ error: 'Missing token' }, 400);
          }

          const payload = await verifyToken(
            token,
            options.signingSecret,
            'upload',
          );
          if (!payload) {
            return jsonResponse({ error: 'Invalid or expired token' }, 403);
          }

          // Defense-in-depth: the key must match the bound record.
          if (
            !isValidFileKey(
              payload.key,
              payload.table,
              payload.column,
              payload.recordId,
            )
          ) {
            return jsonResponse({ error: 'Invalid key' }, 403);
          }

          // Enforce the token-bound content type: the request must declare the
          // same MIME type that was validated at presign (the guarantee S3's
          // signed-header PUT gives, applied at our own route). Compare the
          // essence only — ignore any parameters (e.g. `; charset=`) and case.
          const essence = (v: string | undefined) =>
            (v ?? '').split(';')[0]!.trim().toLowerCase();
          if (essence(ctx.contentType) !== essence(payload.contentType)) {
            return jsonResponse({
              error: 'Content-Type does not match the upload token',
            }, 415);
          }

          if (!ctx.bodyStream) {
            return jsonResponse({ error: 'No body' }, 400);
          }

          try {
            assertSafeKey(payload.key);
            // Stream straight to disk, enforcing the token-bound size exactly.
            // The adapter rejects (and commits nothing) on a size mismatch or
            // if the cap is exceeded mid-stream.
            await options.fs.put(payload.key, ctx.bodyStream, {
              expectedSize: payload.size,
            });
          } catch (err) {
            const name = (err as { name?: string })?.name;
            if (name === 'BodyTooLargeError') {
              return jsonResponse({ error: 'File too large' }, 413);
            }
            if (name === 'SizeMismatchError') {
              return jsonResponse({ error: 'Size mismatch' }, 400);
            }
            return jsonResponse({ error: 'Failed to write file' }, 500);
          }

          return jsonResponse({ ok: true, key: payload.key });
        },
      },
      // Serving route (GET /admin/fs-storage/_serve?token=...)
      // Streams the file from disk straight to the response. Authorised by the
      // signed download token. When the adapter exposes `getStream` (both
      // built-in adapters do) the body is never fully buffered; a custom
      // adapter without it falls back to the buffered `get`.
      {
        pattern: '_serve',
        methods: ['GET'],
        resourceIntensive: true,
        handler: async (ctx) => {
          let token: string | null = null;
          try {
            token = new URL(ctx.requestUrl).searchParams.get('token');
          } catch { /* malformed URL */ }
          if (!token) {
            return new Response('Missing token', { status: 400 });
          }

          const payload = await verifyToken(
            token,
            options.signingSecret,
            'download',
          );
          if (!payload) {
            return new Response('Invalid or expired token', { status: 403 });
          }

          // Stream the bytes straight from disk; fall back to a buffered read
          // for adapters that don't implement `getStream`.
          let body: ReadableStream<Uint8Array> | Uint8Array;
          let contentLength: number;
          try {
            assertSafeKey(payload.key);
            if (options.fs.getStream) {
              const opened = await options.fs.getStream(payload.key);
              body = opened.stream;
              contentLength = opened.size;
            } else {
              const bytes = await options.fs.get(payload.key);
              body = bytes;
              contentLength = bytes.length;
            }
          } catch {
            return new Response('Not found', { status: 404 });
          }

          const filename = payload.filename ?? payload.key.split('/').pop() ??
            'download';
          const extMatch = filename.match(/\.[^.]+$/);
          const contentType =
            (extMatch ? typeByExtension(extMatch[0]!.toLowerCase()) : null) ??
              'application/octet-stream';

          // Always attachment + nosniff + strict CSP: directly-served files
          // bypass the per-file CSP the DB-inline path applies, so harden here
          // (scriptable content like SVG must never run inline).
          //
          // A `ReadableStream` is a valid body as-is; the `Uint8Array` fallback
          // needs the cast to bridge the `Uint8Array<ArrayBufferLike>` vs
          // `BufferSource` generic friction in the DOM lib types.
          return new Response(body as unknown as BodyInit, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(contentLength),
              // `contentDispositionHeader` emits the dual `filename` +
              // `filename*=UTF-8''…` form; a raw interpolation here would throw a
              // `TypeError` (header values are ByteStrings) for any non-ASCII
              // filename such as `写真.jpg`.
              'Content-Disposition': contentDispositionHeader(
                'attachment',
                filename,
              ),
              'X-Content-Type-Options': 'nosniff',
              'X-Frame-Options': 'DENY',
              'Content-Security-Policy':
                "default-src 'none'; img-src 'self' data:; style-src 'none'; script-src 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
              'Cache-Control': 'private, max-age=60, must-revalidate',
            },
          });
        },
      },
    ],
  };
}
