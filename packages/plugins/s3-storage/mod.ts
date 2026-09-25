/**
 * S3 Storage Plugin for HotSauce CMS
 *
 * Provides presigned upload URLs for direct browser-to-S3 uploads,
 * and signed download URLs for policy-aware file serving.
 *
 * Works with any S3-compatible storage: AWS S3, MinIO, Cloudflare R2,
 * Backblaze B2, DigitalOcean Spaces, and more.
 *
 * @example
 * ```ts
 * import { createS3StoragePlugin } from '@hotsauce/plugins/s3-storage';
 *
 * const handler = createCmsHandler({
 *   db, schema,
 *   plugins: [
 *     createS3StoragePlugin({
 *       basePath: '/admin',
 *       endpoint: 'https://s3.us-east-1.amazonaws.com',
 *       region: 'us-east-1',
 *       bucket: 'my-uploads',
 *       accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *       secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *     }),
 *   ],
 *   storage: {
 *     defaultObjectStorageId: 's3',
 *   },
 * });
 * ```
 *
 * @module
 */

import type { InProcessPluginConfig } from '@hotsauce/cms';
import type { ResolvedS3Options, S3StoragePluginOptions } from './types.ts';
import type {
  DeleteContext,
  PresignContext,
  PresignResult,
  SignDownloadContext,
  StorageProvider,
} from '@hotsauce/cms';
import { getFileKeyPrefix } from '@hotsauce/core';
import { typeByExtension } from '@std/media-types';
import { attrs, html, raw } from '@hotsauce/ui';
import { buildObjectUrl, presignUrl, signHeaders } from './sigv4.ts';
import { UPLOAD_CSS } from './upload-styles.ts';
import { UPLOAD_JS } from './upload-script.ts';

// Re-export types for convenience
export type { S3StoragePluginOptions } from './types.ts';

// ─────────────────────────────────────────────────────────────
// File Validation
// ─────────────────────────────────────────────────────────────

/** Safely serialize a value for embedding in <script type="application/json">. */
function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

/** Default max file size for S3 uploads: 10MB. Set maxSize: 0 in $cms() to disable. */
export const S3_DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

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
 * Validate a presign request against column $cms() options.
 * Returns `{ error: string }` if invalid, `null` if valid.
 *
 * Applies S3_DEFAULT_MAX_SIZE (10MB) when no explicit maxSize is set.
 * Set `$cms({ file: { maxSize: 0 } })` to disable the size limit.
 */
export function validatePresignRequest(
  body: { filename: string; contentType: string; size: number },
  fieldConfig: Record<string, unknown> | undefined,
): { error: string } | null {
  const normalizedConfig = resolveFileConfig(fieldConfig);
  if (!normalizedConfig) return null;

  const maxSize = typeof normalizedConfig.maxSize === 'number'
    ? normalizedConfig.maxSize
    : S3_DEFAULT_MAX_SIZE;
  if (maxSize > 0 && body.size > maxSize) {
    const label = maxSize >= 1_048_576
      ? `${Math.round(maxSize / 1_048_576)}MB`
      : `${Math.round(maxSize / 1024)}KB`;
    return { error: `File too large. Maximum size is ${label}.` };
  }

  // Cross-validate claimed content type against file extension.
  // Files without extensions skip this check and rely on content-type +
  // accept pattern validation alone. Duplicated in packages/cms/http.ts.
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
  if (accept && accept !== '*/*') {
    const patterns = accept.split(',').map((p) => p.trim().toLowerCase());
    const type = body.contentType.toLowerCase();
    const matched = patterns.some((pattern) => {
      if (pattern === '*/*') return true;
      if (pattern === type) return true;
      if (pattern.endsWith('/*')) {
        return type.startsWith(pattern.slice(0, -1));
      }
      return false;
    });
    if (!matched) {
      return { error: `Invalid file type. Accepted: ${accept}` };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Unique Key Generation
// ─────────────────────────────────────────────────────────────

/**
 * Generate a unique object key for uploads.
 *
 * Format: {table}/{column}/{recordId}/{uuid}-{filename}
 *
 * Every upload produces a globally unique key. Keys are NEVER reused.
 * This is a correctness requirement for:
 * - Backup safety (old objects remain addressable)
 * - Race condition avoidance
 * - CDN cache correctness
 * - Ransomware resilience
 */
function generateObjectKey(
  table: string,
  column: string,
  recordId: string,
  filename: string,
): string {
  const uuid = crypto.randomUUID();
  // Sanitize filename to be URL-safe
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Use shared prefix from core to ensure consistency with key validation
  return `${getFileKeyPrefix(table, column, recordId)}${uuid}-${safeFilename}`;
}

// ─────────────────────────────────────────────────────────────
// Key safety
// ─────────────────────────────────────────────────────────────

/**
 * Validate that a storage key is safe to embed in a URL path.
 *
 * `isValidFileKey` (core) checks that a key carries the right
 * `{table}/{column}/{recordId}/` prefix, but it does NOT guard against path
 * traversal. This does: it rejects absolute paths, backslashes, `.`/`..`
 * segments, empty segments, and control characters — so a tampered or
 * malicious key can never escape the CDN base or bucket prefix.
 *
 * @throws Error if the key is unsafe.
 */
function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Invalid storage key: empty');
  }
  // No absolute paths, no Windows drive letters, no backslashes.
  if (key.startsWith('/') || key.startsWith('\\') || /^[a-zA-Z]:/.test(key)) {
    throw new Error(`Invalid storage key: absolute path "${key}"`);
  }
  if (key.includes('\\')) {
    throw new Error(`Invalid storage key: backslash in "${key}"`);
  }
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f]/.test(key)) {
    throw new Error('Invalid storage key: control character');
  }
  // Reject percent-encoding. Keys are minted from a restricted charset and
  // never contain '%'; it is only meaningful as an encoded byte, which a URL
  // consumer fronting downloads (e.g. a CDN behind `cdnBaseUrl`) may decode
  // into a separator or dot-segment (%2f -> '/', %2e -> '.'), smuggling
  // traversal past the literal checks above. The `..`/segment checks below run
  // on the raw key, so reject the encoded form at the source.
  if (key.includes('%')) {
    throw new Error(`Invalid storage key: percent-encoding in "${key}"`);
  }
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Invalid storage key: unsafe segment in "${key}"`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Storage Provider Implementation
// ─────────────────────────────────────────────────────────────

/**
 * Create the storage provider for the CMS registry.
 */
function createStorageProvider(options: ResolvedS3Options): StorageProvider {
  return {
    id: options.storageId,
    kind: 's3',

    /**
     * Generate a presigned PUT URL for direct upload.
     */
    async presignUpload(ctx: PresignContext): Promise<PresignResult> {
      const bucket = typeof options.bucket === 'function'
        ? options.bucket({
          request: ctx.request,
          user: ctx.user,
          table: ctx.table,
          column: ctx.column,
          action: ctx.action,
          recordId: ctx.recordId,
        })
        : options.bucket;

      // Generate unique key
      const key = generateObjectKey(
        ctx.table,
        ctx.column,
        ctx.recordId!,
        ctx.filename,
      );

      // Build the object URL using publicEndpoint (browser-facing)
      // This ensures the presigned URL is accessible from the browser
      const objectUrl = buildObjectUrl(
        options.publicEndpoint,
        bucket,
        key,
        options.urlStyle,
      );

      // Sign Content-Length and Content-Type so S3 enforces exact file
      // size and MIME type. The client must send these headers verbatim.
      const uploadHeaders: Record<string, string> = {
        'Content-Length': String(ctx.size),
        'Content-Type': ctx.contentType,
      };

      // Generate presigned PUT URL
      const presignedUrl = await presignUrl({
        method: 'PUT',
        url: objectUrl,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        expirySeconds: options.expirySeconds,
        headers: uploadHeaders,
      });

      return {
        key,
        upload: {
          method: 'PUT',
          url: presignedUrl,
          headers: uploadHeaders,
        },
      };
    },

    /**
     * Generate a signed GET URL for downloads.
     */
    async signDownloadUrl(ctx: SignDownloadContext): Promise<string> {
      // Core's isValidFileKey only validates the key prefix — reject
      // traversal/unsafe keys here before either branch links or signs them
      // (mirrors fs-storage's signDownloadUrl).
      assertSafeKey(ctx.key);

      const bucket = typeof options.bucket === 'function'
        ? options.bucket({
          request: ctx.request ?? new Request('https://internal'),
          user: ctx.user ?? null,
          table: '', // Not available in download context
          column: '',
          action: 'read',
          recordId: undefined,
        })
        : options.bucket;

      // If CDN is configured, serve downloads through it.
      if (options.cdnBaseUrl) {
        // NOTE: this returns a BARE, unsigned URL — access control is delegated
        // entirely to the CDN. Safe only when the objects are public or the CDN
        // gates them itself (e.g. signed cookies / a private distribution);
        // otherwise it bypasses the CMS row/column policy the /files/ route
        // enforced before redirecting here. See `cdnBaseUrl` in types.ts.
        // Build via the URL API so key encoding matches the presigned branch
        // (buildObjectUrl): unsafe characters are encoded and existing %XX
        // escapes preserved — though assertSafeKey above already rejects '%'.
        const url = new URL(options.cdnBaseUrl);
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/${ctx.key}`;
        return url.toString();
      }

      // Build object URL using publicEndpoint (browser-facing)
      const objectUrl = buildObjectUrl(
        options.publicEndpoint,
        bucket,
        ctx.key,
        options.urlStyle,
      );

      // Generate presigned GET URL
      return await presignUrl({
        method: 'GET',
        url: objectUrl,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        expirySeconds: options.expirySeconds,
      });
    },

    /**
     * Delete an object from storage.
     */
    async deleteObject(ctx: DeleteContext): Promise<void> {
      // The key comes from a stored FileReference that a client with update
      // rights could have crafted; core only checks its prefix. A `..` segment
      // would be dot-normalised by the URL parser into a sibling prefix (or,
      // path-style, a sibling bucket) and the SigV4 signature would be valid
      // for that collapsed path. Reject it here, as signDownloadUrl does.
      assertSafeKey(ctx.key);

      const bucket = typeof options.bucket === 'function'
        ? options.bucket({
          request: ctx.request ?? new Request('https://internal'),
          user: ctx.user ?? null,
          table: '',
          column: '',
          action: 'delete',
          recordId: undefined,
        })
        : options.bucket;

      const objectUrl = buildObjectUrl(
        options.endpoint,
        bucket,
        ctx.key,
        options.urlStyle,
      );

      // Sign the DELETE request
      const headers = await signHeaders({
        method: 'DELETE',
        url: objectUrl,
        region: options.region,
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      });

      // Execute the DELETE request
      const response = await fetch(objectUrl, {
        method: 'DELETE',
        headers,
      });

      // 204 No Content or 200 OK are both success
      // 404 is also okay (object already deleted)
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `Failed to delete object: ${response.status} ${response.statusText}`,
        );
      }
    },

    /**
     * List objects under a prefix (for orphan cleanup).
     * Uses the S3 ListObjectsV2 API with pagination.
     */
    async listObjects(
      prefix: string,
    ): Promise<Array<{ key: string; lastModified: Date; size: number }>> {
      const bucket = typeof options.bucket === 'function'
        ? options.bucket({
          request: new Request('https://internal'),
          user: null,
          table: '',
          column: '',
          action: 'read',
          recordId: undefined,
        })
        : options.bucket;

      const results: Array<{ key: string; lastModified: Date; size: number }> =
        [];
      let continuationToken: string | undefined;

      do {
        // Build the ListObjectsV2 URL: GET /{bucket}?list-type=2&prefix=...
        const baseUrl = new URL(options.endpoint);
        if (options.urlStyle === 'virtual-hosted') {
          baseUrl.hostname = `${bucket}.${baseUrl.hostname}`;
        } else {
          baseUrl.pathname = `/${bucket}`;
        }
        baseUrl.searchParams.set('list-type', '2');
        baseUrl.searchParams.set('prefix', prefix);
        baseUrl.searchParams.set('max-keys', '10');
        if (continuationToken) {
          baseUrl.searchParams.set('continuation-token', continuationToken);
        }

        const url = baseUrl.toString();

        const headers = await signHeaders({
          method: 'GET',
          url,
          region: options.region,
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        });

        const response = await fetch(url, { method: 'GET', headers });

        if (!response.ok) {
          throw new Error(
            `ListObjectsV2 failed: ${response.status} ${response.statusText}`,
          );
        }

        const xml = await response.text();

        // Parse the XML response for <Contents> entries
        const contentsRegex =
          /<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(.*?)<\/Size>[\s\S]*?<\/Contents>/g;
        let match;
        while ((match = contentsRegex.exec(xml)) !== null) {
          results.push({
            key: match[1]!,
            lastModified: new Date(match[2]!),
            size: parseInt(match[3]!, 10),
          });
        }

        // Check for pagination
        const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
        const tokenMatch = xml.match(
          /<NextContinuationToken>(.*?)<\/NextContinuationToken>/,
        );
        continuationToken = isTruncated && tokenMatch
          ? tokenMatch[1]
          : undefined;
      } while (continuationToken);

      return results;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Plugin Factory
// ─────────────────────────────────────────────────────────────

/**
 * Create an S3-compatible storage plugin for the CMS.
 *
 * This plugin provides:
 * - Presigned upload URLs for direct browser-to-S3 uploads
 * - Signed download URLs for policy-aware file serving
 * - Standalone upload page (no JS in CMS core pages)
 * - "Upload to S3" links on edit forms
 *
 * @param pluginOptions - Plugin configuration
 * @returns Plugin configuration to pass to createCmsHandler
 */
export function createS3StoragePlugin(
  pluginOptions: S3StoragePluginOptions,
): InProcessPluginConfig {
  // Resolve options with defaults
  const options: ResolvedS3Options = {
    storageId: pluginOptions.storageId ?? 's3',
    endpoint: pluginOptions.endpoint,
    publicEndpoint: pluginOptions.publicEndpoint ?? pluginOptions.endpoint,
    region: pluginOptions.region,
    bucket: pluginOptions.bucket,
    accessKeyId: pluginOptions.accessKeyId,
    secretAccessKey: pluginOptions.secretAccessKey,
    urlStyle: pluginOptions.urlStyle ?? 'virtual-hosted',
    expirySeconds: pluginOptions.expirySeconds ?? 900,
    cdnBaseUrl: pluginOptions.cdnBaseUrl,
    basePath: pluginOptions.basePath,
  };

  // Create storage provider
  const storageProvider = createStorageProvider(options);

  return {
    name: 's3-storage',
    description: 'S3-compatible storage for file uploads',
    storageProvider,

    filter: (ctx) => {
      // Allow UI hooks for file columns
      if (ctx.hookType === 'ui:renderField') return true;
      // Allow route handlers
      if (ctx.hookType === 'route') return true;
      return false;
    },

    hooks: {
      ui: {
        /**
         * Render file field UI for create, edit, and detail pages.
         * - Create: "Save record first" message (no file input - S3 needs recordId for path)
         * - Edit: "Upload to S3" link + file summary + image preview
         * - Detail: file summary + image preview (no upload link)
         */
        renderField: (ctx) => {
          // Only for file fields
          if (ctx.field.fieldType !== 'file') {
            return null;
          }

          // Only render if this field's storage matches this plugin's storageId
          // This respects resolveStorage callback for per-column routing
          if (ctx.storageId !== options.storageId) {
            return null;
          }

          // Create view: no recordId yet, can't generate S3 upload path.
          // Tables with $cms({ autoDraft: true }) skip this — they redirect
          // to the edit view automatically. This message only appears on
          // tables without autoDraft.
          if (ctx.view === 'create' || !ctx.recordId) {
            return {
              valueSummary: 'Save this record first to enable S3 uploads',
            };
          }

          // Detail view or edit view - proceed with normal rendering
          if (ctx.view !== 'edit' && ctx.view !== 'detail') {
            return null;
          }

          // Generate summary of current file and URL for download/preview
          let valueSummary = 'No file';
          let fileUrl: string | undefined;
          if (ctx.value && typeof ctx.value === 'object') {
            const file = ctx.value as {
              filename?: string;
              size?: number;
              storage?: string;
              contentType?: string;
              key?: string;
              data?: string;
            };
            if (file.filename) {
              const sizeKb = file.size ? Math.round(file.size / 1024) : 0;
              const storage = file.storage ?? (file.data ? 'db' : 's3');
              valueSummary = `${file.filename} (${sizeKb}KB, ${storage})`;

              // Generate URL for file preview/download
              // The /files/ endpoint handles both DB-stored (data) and S3 (key) files
              if (file.key || file.data) {
                fileUrl =
                  `${options.basePath}/files/${ctx.table}/${ctx.field.name}/${ctx.recordId}`;
              }
            }
          }

          // Detail view: no upload link, just summary and file URL
          if (ctx.view === 'detail') {
            return {
              valueSummary,
              ...(fileUrl && { fileUrl }),
            };
          }

          // Edit view: include upload link
          const href =
            `${options.basePath}/s3-storage/${ctx.table}/${ctx.recordId}/${ctx.field.name}`;

          return {
            link: { href, label: 'Upload via S3', target: '_blank' },
            valueSummary,
            ...(fileUrl && { fileUrl }),
          };
        },
      },
    },

    routes: [
      // Serve embedded upload page CSS
      {
        pattern: '_assets/upload.css',
        methods: ['GET'],
        handler: () =>
          new Response(UPLOAD_CSS, {
            headers: { 'Content-Type': 'text/css; charset=utf-8' },
          }),
      },
      // Serve embedded upload page JS
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
      // Upload page (GET /admin/s3-storage/:table/:id/:column)
      {
        pattern: ':table/:id/:column',
        methods: ['GET'],
        csp: { connectSrc: [options.publicEndpoint] },
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
          const acceptValue = resolvedFieldConfig.accept;
          const maxSizeValue = resolvedFieldConfig.maxSize;

          const acceptAttr = typeof acceptValue === 'string'
            ? { accept: acceptValue }
            : {};

          const uploadCssUrl =
            `${options.basePath}/s3-storage/_assets/upload.css`;
          const uploadJsUrl =
            `${options.basePath}/s3-storage/_assets/upload.js`;

          // Check for ?return= query param (e.g. from grid panel)
          // Defense-in-depth checks aligned with packages/cms/crud.ts:getSafeReturnUrl
          let returnUrl: string | undefined;
          try {
            const reqUrl = new URL(ctx.requestUrl);
            const returnParam = reqUrl.searchParams.get('return')?.trim();
            // Validate: must start with basePath, no protocol markers, no dangerous chars
            if (
              returnParam &&
              (returnParam === options.basePath ||
                returnParam.startsWith(options.basePath + '/')) &&
              !returnParam.includes('://') &&
              !returnParam.startsWith('//') &&
              // Block control characters and backslashes (scheme obfuscation / header injection)
              // deno-lint-ignore no-control-regex
              !/[\x00-\x1f\x7f-\x9f\\]/.test(returnParam) &&
              // Block percent-encoded control chars (%00-%1F, %7F)
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
              : S3_DEFAULT_MAX_SIZE,
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

                  <div class="upload-area" id="uploadArea">
                    <input type="file" id="fileInput" ${attrs(acceptAttr)}>
                    <p>Click or drag a file here to upload</p>
                  </div>

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

          // Return HTML string — CMS applies security headers
          // (users must configure csp.connectSrc in CmsOptions for S3 uploads)
          return page;
        },
      },
      // Presign endpoint (POST /admin/s3-storage/:table/:id/:column)
      // Same URL as upload page, different method - CMS handles policy checks
      {
        pattern: ':table/:id/:column',
        methods: ['POST'],
        resourceIntensive: true,
        handler: async (ctx) => {
          const { table, id, column } = ctx.params;

          // These are guaranteed by the route pattern :table/:id/:column
          if (!table || !id || !column) {
            return new Response('Not found', { status: 404 });
          }

          // Request body should be JSON with file info only
          // (table/id/column come from URL params, which CMS has policy-checked)
          let body: {
            filename: string;
            contentType: string;
            size: number;
          };

          try {
            if (!ctx.body) {
              throw new Error('No request body');
            }
            body = JSON.parse(ctx.body);
          } catch {
            return new Response(
              JSON.stringify({ error: 'Invalid JSON body' }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Validate required fields (use explicit checks for size since 0 is valid)
          if (
            !body.filename ||
            !body.contentType ||
            typeof body.size !== 'number'
          ) {
            return new Response(
              JSON.stringify({ error: 'Missing required fields' }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Validate file size and content type against $cms() field config
          const fieldConfig = ctx.field?.config as
            | Record<string, unknown>
            | undefined;

          // Only presign for columns explicitly configured as file fields.
          // Without this, an authenticated user could mint presigned PUTs to
          // arbitrary bucket prefixes for any (or a nonexistent) column, with
          // no size/accept limits (validatePresignRequest is a no-op when
          // `$cms({ file: ... })` is absent) and no orphan cleanup.
          if (!resolveFileConfig(fieldConfig)) {
            return new Response(
              JSON.stringify({ error: 'Not a file field' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          const validationError = validatePresignRequest(body, fieldConfig);
          if (validationError) {
            return new Response(
              JSON.stringify(validationError),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Generate presigned upload URL
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

          return new Response(
            JSON.stringify({
              storage: options.storageId,
              key: presignResult.key,
              upload: presignResult.upload,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        },
      },
    ],
  };
}
