# @hotsauce/plugins/puck

Puck visual editor plugin for HotSauce CMS.

Adds "Edit with Puck" links to JSON columns and provides routes for the Puck editor UI.

## Overview

This plugin is **version-agnostic** — you provide your own Puck bundle and CSS. This allows you to:

- Control the Puck version
- Include your own React components
- Use the same components for both editing and frontend rendering

## Installation

```ts
import { createPuckPlugin } from '@hotsauce/plugins/puck';

const handler = createCmsHandler({
  db,
  schema,
  basePath: '/admin',
  plugins: [
    createPuckPlugin({
      basePath: '/admin',
      componentsJs: '/admin/components.js', // Your bundled components
      componentsCss: '/admin/components.css', // Optional: custom styles
    }),
  ],
});
```

## User-Provided Components

You provide a components file that exports `puckProps` containing:

- Your Puck `config` with component definitions
- Any additional Puck props (viewports, permissions, overrides, etc.)

The plugin automatically includes React, ReactDOM, and Puck's editor bundle.

### Example Components File

Export a `puckProps` object containing your Puck configuration:

```tsx
// components.tsx
import type { ComponentConfig, PuckProps } from '@hotsauce/plugins/puck';
import { DropZone, React } from '@hotsauce/plugins/puck/client/globals';

// Define your components
const Heading: ComponentConfig = {
  fields: { text: { type: 'text' } },
  render: ({ text }) => <h1>{text}</h1>,
};

const Columns: ComponentConfig = {
  render: () => (
    <div style={{ display: 'flex', gap: '1rem' }}>
      <div style={{ flex: 1 }}>
        <DropZone zone='left' />
      </div>
      <div style={{ flex: 1 }}>
        <DropZone zone='right' />
      </div>
    </div>
  ),
};

// Export puckProps with config and any Puck props you want
export const puckProps: PuckProps = {
  config: {
    components: { Heading, Columns },
  },
  // Optional: customize Puck behavior
  viewports: [
    { width: 1440, label: 'Desktop', icon: 'Monitor' },
    { width: 768, label: 'Tablet', icon: 'Tablet' },
    { width: 375, label: 'Mobile', icon: 'Smartphone' },
  ],
  // iframe: { enabled: true },
  // onPublish: async (data) => { ... }, // Override save behavior
};
```

The `globals.ts` helper provides pre-typed React and DropZone from `globalThis`, so you don't need to set up React imports manually.

### Build with Deno

```bash
# Bundle components for browser
deno bundle --platform browser --minify components.tsx -o admin/components.js

# Fetch Puck CSS (or bundle your own)
curl -o admin/puck.css https://esm.sh/@puckeditor/core@0.21.1/puck.css
```

## Schema Setup

Mark JSON columns with `.$cms({ plugins: { puck: true } })`:

### PostgreSQL

```ts
import { jsonb, pgTable, serial, text } from 'drizzle-orm/pg-core';
import '@hotsauce/core/extend'; // Adds .$cms() method

export const pages = pgTable('pages', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: jsonb('content').$cms({ plugins: { puck: true } }),
});
```

### SQLite

For SQLite, use `{ mode: 'json' }` so Drizzle automatically parses the JSON:

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import '@hotsauce/core/extend';

export const pages = sqliteTable('pages', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  // mode: 'json' ensures Drizzle returns parsed objects, not strings
  content: text('content', { mode: 'json' }).$cms({ plugins: { puck: true } }),
});
```

> **Tip:** Using `{ mode: 'json' }` is recommended so Drizzle handles JSON parsing automatically.

## How It Works

1. Columns marked with `plugins: { puck: true }` display an "Edit with Puck" button
2. The button links to `/admin/puck/:table/:id/:column`
3. Plugin serves an HTML shell with bootstrap data (CSRF, source token, initial data)
4. Your bundle loads and mounts the Puck editor
5. Changes are saved back through the standard CMS CRUD routes

## Plugin Routes

| Route                                | Description                   |
| ------------------------------------ | ----------------------------- |
| `GET /admin/puck/:table/:id/:column` | Puck editor page (HTML shell) |

### CSP

The editor route automatically declares `csp: { styleSrc: ["'unsafe-inline'"] }` because Puck/React sets inline `style` attributes on DOM elements at runtime (drag handles, overlays, positioning). This is merged with the global CSP at startup — only the editor route is relaxed; asset routes remain strict. No user configuration needed.

## Frontend Rendering (SSR)

For server-side rendering of Puck content, use the `/rsc` export to avoid browser dependencies:

```tsx
// site/render.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { type Config, type Data } from '@puckeditor/core';
import { Render } from '@puckeditor/core/rsc';

// Set globalThis.React before importing components
(globalThis as any).React = React;

export async function renderPuckContent(
  data: Data,
  config: Config,
): Promise<string> {
  const element = <Render config={config} data={data} />;
  return renderToStaticMarkup(element);
}
```

The `/rsc` export is lighter and doesn't pull in browser-only dependencies like `happy-dom`.

## Image Picker Field

The plugin provides an `ImagePickerField` component for selecting images from CMS tables in Puck's sidebar. This is useful for Image components or any field that references uploaded images.

### Usage

```tsx
import {
  ImagePickerField,
  type SelectedImage,
} from '@hotsauce/plugins/puck/fields';

const Image: ComponentConfig = {
  label: 'Image',
  fields: {
    media: {
      type: 'custom',
      label: 'Image',
      render: ({ value, onChange }) => (
        <ImagePickerField
          value={value as SelectedImage | null}
          onChange={onChange}
          table='media' // Table to pick from (default: 'media')
        />
      ),
    },
    alt: { type: 'text', label: 'Alt Text' },
  },
  render: ({ media, alt }) => {
    const m = media as SelectedImage | null;
    if (!m?.id) return <div>No image selected</div>;
    return <img src={`/files/${m.table}/${m.id}`} alt={alt as string} />;
  },
};
```

### SelectedImage Type

The picker stores a reference to the image record, not the image data itself:

```ts
type SelectedImage = {
  id: string | number; // Primary key of the record
  table: string; // Table name (e.g., 'media', 'photos')
  column: string; // File column property name (e.g., 'file', 'coverImage')
  alt?: string; // Alt text from the record (if available)
  filename?: string; // Original filename (for display and SEO-friendly URLs)
};
```

URLs are constructed at render time using file proxy routes. When `filename` is available, it's appended for SEO-friendly URLs:

- Editor: `/admin/files/{table}/{column}/{id}[/{filename}]`
- Frontend: `/files/{table}/{id}[/{filename}]` (you provide this route)

### Props

| Prop       | Type                                     | Default    | Description                   |
| ---------- | ---------------------------------------- | ---------- | ----------------------------- |
| `value`    | `SelectedImage \| null`                  | —          | Current selection             |
| `onChange` | `(value: SelectedImage \| null) => void` | —          | Called when selection changes |
| `basePath` | `string`                                 | `'/admin'` | CMS base path                 |
| `table`    | `string`                                 | `'media'`  | Table to pick from            |
| `altField` | `string`                                 | `'alt'`    | Column to use for alt text    |

### How It Works

1. User clicks "Pick Image" → Opens a `<dialog>` modal
2. Modal contains an iframe pointing to `{basePath}/{table}?picker=true&__cms_source=<token>`
3. CMS renders a minimal grid view (no sidebar, picker mode)
4. User clicks an image → CMS posts `cms:media-selected` to parent window
5. Component validates `event.source` matches the iframe, then calls `onChange`

**Security:** Messages are validated via `event.source` to prevent spoofing from other scripts/tabs. The CMS posts only to `window.location.origin` (same-origin required). The `__cms_source` token is automatically provided by the CMS context.

### Source Columns (Alt Text)

By default, the picker only sends the primary key. All other columns — including the file column — require explicit opt-in via `plugins: { puck: { role: 'source' } }`. This ensures no data is accidentally exposed to plugins.

```ts
export const media = pgTable('media', {
  id: serial('id').primaryKey(), // Always sent (not configurable)
  // File column: thumbnail: true for grid display, role: 'source' for picker data
  file: jsonb('file').$type<FileReference>().$cms({
    file: { accept: 'image/*' },
    thumbnail: true, // Grid rendering
    plugins: { puck: { role: 'source' } }, // Data exposure
  }),
  // Alt text as source data — included in picker postMessage
  alt: text('alt').$cms({
    plugins: { puck: { role: 'source' } },
  }),
  // Caption is NOT marked — excluded from picker data
  caption: text('caption'),
});
```

With this configuration:

- `id` is always included (primary key)
- `file` is included because it's marked as a Puck source column
- `alt` is included because it's marked as a Puck source column
- `caption` is excluded (no plugin config)

> **Note:** `thumbnail: true` controls grid view rendering. `plugins: { puck: { role: 'source' } }` controls what data flows to Puck. These are separate concerns — you need both for a fully functional picker.

The `ImagePickerField` component automatically reads `alt` from the picker's `record` data when available.

This uses the CMS [picker mode](../cms/README.md) feature, which works with any table that has a `thumbnail: true` column.

## Security Considerations

### Components bundle trust boundary

The `componentsJs` bundle runs in the browser with full access to the admin session. Any code you import into it — including transitive npm dependencies — can make authenticated requests to the CMS, read records, and overwrite content. There is no sandbox between the bundle and the session.

**Practical guidance:**

- Audit `components.tsx` dependencies the same way you would any server-side dependency
- Pin npm packages to specific audited versions
- Prefer zero-dependency packages where possible

This is an inherent consequence of the "bring your own bundle" architecture. The CMS cannot protect against a compromised dependency in your bundle, any more than a Node.js app can protect against a compromised `node_modules` package.

### `CmsContext.sourceToken`

`globalThis.CmsContext.sourceToken` is readable by any module in the bundle for the same reason above. It is not a secret — treat it as accessible to all your bundle code. Its purpose is to identify the originating plugin to the CMS (enabling `ctx.source`-based row policies), not to authenticate the user.

## Example Project

See `apps/demo/` for a complete working example with Puck integration.
