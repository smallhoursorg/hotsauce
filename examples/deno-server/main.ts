// deno-lint-ignore-file no-console
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import {
  adminOr,
  createCmsHandler,
  ownedBy,
  PasswordProvider,
  readOnly,
} from '@hotsauce/cms';
import {
  inProcessFormatNamesPlugin,
  isolatedAuditLogPlugin,
} from './plugins.ts';
import { parsers, posts, schema, users } from './schema.ts';

// Database connection (persisted to ./data)
const client = new PGlite('./data');
const db = drizzle(client, { schema });

// Create CMS handler with authentication
// Secrets can be passed directly or via environment variables:
//   CMS_2FA_SECRET - for 2FA challenge token signing
//   CMS_CSRF_SECRET - for CSRF token signing
//   CMS_JWT_SECRET - for JWT signing (when auth enabled)
const cmsHandler = createCmsHandler({
  db,
  schema,
  basePath: '/admin',
  // JWT authentication with optional 2FA - enables /login, /logout, and /account routes
  auth: {
    // PasswordProvider: password auth with optional TOTP 2FA (if user has totpSecret)
    // Uses CMS_2FA_SECRET env var for challenge token signing
    provider: new PasswordProvider({
      db,
      usersTable: users,
      issuer: 'HotSauce CMS Demo', // For TOTP URI
    }),
  },
  // Row-level security policies (atomic authorization in WHERE clauses)
  policies: {
    posts: adminOr(ownedBy(posts, 'authorId')), // Admins see all, users see own
    categories: readOnly(), // Admins: full access, others: read-only
    users: {
      columns: {
        passwordHash: { read: () => false }, // Hide password hashes (keyed by property name)
      },
    },
  },
  // Plugins for extending CMS functionality
  plugins: [
    // Worker-isolated plugin (recommended for third-party)
    isolatedAuditLogPlugin,
    // In-process plugin example (for trusted first-party code)
    inProcessFormatNamesPlugin,
  ],
  // User input parsers for validation (validation library agnostic)
  parsers,
  // Log errors to console (in production, use a proper logging service)
  onError: (error, context) => console.error('CMS Error:', { error, context }),
});

// Simple HTTP server
const PORT = 3000;

console.log(`🚀 CMS running at http://localhost:${PORT}/admin`);
console.log(`   Login with the admin account created by seed.ts`);

Deno.serve({ port: PORT, hostname: '127.0.0.1' }, async (request: Request) => {
  const url = new URL(request.url);

  // Redirect root to admin
  if (url.pathname === '/') {
    return Response.redirect(new URL('/admin', request.url), 302);
  }

  // Handle admin routes (auth is built-in)
  if (url.pathname.startsWith('/admin')) {
    return await cmsHandler(request);
  }

  // 404 for everything else
  return new Response('Not Found', { status: 404 });
});
