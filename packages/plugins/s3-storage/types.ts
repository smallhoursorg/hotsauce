/**
 * S3 Storage Plugin Types
 * @module
 */

/**
 * URL style for S3 object addressing.
 *
 * - `virtual-hosted`: `https://bucket.endpoint/key` (AWS default)
 * - `path`: `https://endpoint/bucket/key` (MinIO, R2, most S3-compatible)
 */
export type S3UrlStyle = 'virtual-hosted' | 'path';

/**
 * Context for resolving bucket dynamically per request.
 * Used for tenant-aware bucket selection.
 */
export interface BucketResolveContext {
  /** Original HTTP request */
  request: Request;
  /** Authenticated user info */
  user: { sub: string; role?: string; [key: string]: unknown } | null;
  /** Table being operated on */
  table: string;
  /** Column being operated on, as its Drizzle property name (e.g. `coverImage`) */
  column: string;
  /** Action being performed */
  action: 'create' | 'update' | 'read' | 'delete';
  /** Record ID (if applicable) */
  recordId?: string;
}

/**
 * Configuration options for the S3 storage plugin.
 *
 * The plugin targets the S3 REST API protocol, not AWS specifically.
 * Works with: AWS S3, MinIO, Cloudflare R2, Backblaze B2, DigitalOcean Spaces,
 * Tigris, Garage, SeaweedFS, and any other S3-compatible endpoint.
 *
 * @example
 * ```ts
 * // AWS S3
 * createS3StoragePlugin({
 *   storageId: 'aws',
 *   endpoint: 'https://s3.us-east-1.amazonaws.com',
 *   region: 'us-east-1',
 *   bucket: 'my-uploads',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 * });
 *
 * // MinIO (self-hosted)
 * createS3StoragePlugin({
 *   storageId: 'minio',
 *   endpoint: 'https://minio.internal:9000',
 *   region: 'us-east-1',
 *   bucket: 'cms-files',
 *   accessKeyId: '...',
 *   secretAccessKey: '...',
 *   urlStyle: 'path',
 * });
 *
 * // Cloudflare R2
 * createS3StoragePlugin({
 *   storageId: 'r2',
 *   endpoint: 'https://<account-id>.r2.cloudflarestorage.com',
 *   region: 'auto',
 *   bucket: 'my-bucket',
 *   accessKeyId: '...',
 *   secretAccessKey: '...',
 *   urlStyle: 'path',
 * });
 * ```
 */
export interface S3StoragePluginOptions {
  /**
   * Unique identifier for this storage provider instance.
   * Used to reference this provider in FileReference.storage and routing.
   *
   * @default 's3'
   */
  storageId?: string;

  /**
   * S3-compatible endpoint URL.
   * REQUIRED - not derived from region (unlike AWS SDK).
   *
   * @example
   * - AWS: 'https://s3.us-east-1.amazonaws.com'
   * - MinIO: 'https://minio.internal:9000'
   * - R2: 'https://<account-id>.r2.cloudflarestorage.com'
   */
  endpoint: string;

  /**
   * Region for SigV4 signing scope.
   * Required for S3 signature, but just a string (not an AWS region enum).
   *
   * @example
   * - AWS: 'us-east-1', 'eu-west-1', etc.
   * - MinIO: 'us-east-1' (default, can be anything)
   * - R2: 'auto'
   */
  region: string;

  /**
   * Bucket name for storage.
   * Can be a string (static) or function (dynamic per-request bucket selection).
   */
  bucket: string | ((ctx: BucketResolveContext) => string);

  /**
   * AWS access key ID or S3-compatible equivalent.
   */
  accessKeyId: string;

  /**
   * AWS secret access key or S3-compatible equivalent.
   */
  secretAccessKey: string;

  /**
   * URL style for object addressing.
   *
   * - `virtual-hosted`: `https://bucket.endpoint/key` (AWS default)
   * - `path`: `https://endpoint/bucket/key` (MinIO, R2, most S3-compatible)
   *
   * @default 'virtual-hosted'
   */
  urlStyle?: S3UrlStyle;

  /**
   * Presigned URL expiry in seconds.
   * Applies to both upload and download URLs.
   *
   * @default 900 (15 minutes)
   */
  expirySeconds?: number;

  /**
   * Public endpoint URL for browser-facing presigned URLs.
   * Use when internal endpoint differs from public URL (e.g., Docker).
   *
   * @example
   * - endpoint: 'http://minio:9000' (internal Docker network)
   * - publicEndpoint: 'http://localhost:9000' (browser-accessible)
   *
   * @default Uses `endpoint` for all URLs
   */
  publicEndpoint?: string;

  /**
   * Optional CDN base URL for serving downloads. When set, `signDownloadUrl`
   * returns `${cdnBaseUrl}/${key}` instead of a presigned S3 URL.
   * Provider-agnostic — works with any CDN (CloudFront, Fastly, R2, …).
   *
   * ⚠️ Unlike the default presigned downloads (SigV4-signed and short-lived via
   * `expirySeconds`), a CDN URL here is **unsigned and non-expiring**. The
   * `/files/` route still checks row/column policy before redirecting, but the
   * issued URL is permanent and shareable, so it bypasses that policy on any
   * later fetch. Set this only when either:
   * - the objects are safe to expose publicly (public assets — edge caching is
   *   the goal), or
   * - the CDN enforces access control itself, e.g. **signed cookies** scoped to
   *   the session (CloudFront/Cloudflare signed cookies) or a private
   *   distribution, so a bare object URL is still gated at the CDN. Note this
   *   gates at the CDN's granularity (typically path/session), which is coarser
   *   than the CMS's per-record policy.
   *
   * This option emits a **bare** URL; it does not generate per-object CDN
   * *signed URLs*, so a CDN configured to require signed URLs (rather than
   * cookies) will reject it. Use signed cookies or a public/gated distribution.
   * (Per-object signed CDN URLs are on the roadmap — see
   * https://github.com/hotsauce-team/hotsauce/issues/91.)
   *
   * @example 'https://cdn.example.com'
   */
  cdnBaseUrl?: string;

  /**
   * CMS base path (e.g., '/admin').
   * Required for generating back links and upload page URLs.
   */
  basePath: string;
}

/**
 * Internal type for resolved plugin options.
 */
export interface ResolvedS3Options {
  storageId: string;
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string | ((ctx: BucketResolveContext) => string);
  accessKeyId: string;
  secretAccessKey: string;
  urlStyle: S3UrlStyle;
  expirySeconds: number;
  cdnBaseUrl?: string;
  basePath: string;
}
