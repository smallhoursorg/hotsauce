/** @jsxRuntime classic */
/** @jsx React.createElement */
/**
 * ImagePickerField - Custom Puck field for selecting images from CMS
 *
 * Opens the CMS grid view in an iframe with `?picker=true&__cms_source=...` mode.
 * When the user clicks an image, the picker posts a `cms:media-selected`
 * message containing the record data and resolved URL.
 *
 * Requires CmsContext (basePath and sourceToken) to be set by the Puck editor.
 * The source token authenticates picker requests so column policies can filter
 * records based on `ctx.source === 'plugin:puck'`.
 *
 * @module
 */

import { CmsContext, React } from '../client/globals.ts';
import {
  PICKER_MESSAGE_TYPE,
  type SelectedImage,
  selectionFromPickerMessage,
} from './selection.ts';

export type { SelectedImage };

// ============================================================================
// Types
// ============================================================================

/**
 * Props for ImagePickerField component.
 */
export type ImagePickerFieldProps = {
  /** Current selected image, or null if none */
  value: SelectedImage | null;
  /** Callback when selection changes */
  onChange: (value: SelectedImage | null) => void;
  /** Base path where the CMS is mounted (defaults to CmsContext.basePath or '/admin') */
  basePath?: string;
  /** Table name to pick from (default: 'media') */
  table?: string;
  /** Column name for alt text on the record (default: 'alt') */
  altField?: string;
};

// ============================================================================
// Component
// ============================================================================

/**
 * Custom Puck field component that opens an image picker dialog.
 *
 * Opens the CMS grid view in an iframe with `?picker=true` mode.
 * When the user clicks an image, the picker posts a `cms:media-selected`
 * message containing the record data and resolved URL.
 *
 * @example
 * ```tsx
 * import { ImagePickerField, SelectedImage } from '@hotsauce/plugins/puck/fields';
 *
 * const Image: ComponentConfig = {
 *   label: 'Image',
 *   fields: {
 *     media: {
 *       type: 'custom',
 *       label: 'Image',
 *       render: ({ value, onChange }) => (
 *         <ImagePickerField
 *           value={value as SelectedImage | null}
 *           onChange={onChange}
 *         />
 *       ),
 *     },
 *   },
 *   // ...
 * };
 * ```
 */
export function ImagePickerField({
  value,
  onChange,
  basePath,
  table = 'media',
  altField = 'alt',
}: ImagePickerFieldProps): React.JSX.Element {
  // Use CmsContext for basePath and sourceToken (set by Puck editor)
  const resolvedBasePath = basePath ?? CmsContext?.basePath ?? '/admin';
  const sourceToken = CmsContext?.sourceToken;

  // Warn if sourceToken is missing (picker mode requires it)
  React.useEffect(() => {
    if (!sourceToken && typeof window !== 'undefined') {
      // deno-lint-ignore no-console
      console.warn(
        '[ImagePickerField] CmsContext.sourceToken not found. ' +
          'Picker mode requires a valid source token. ' +
          'Ensure this component is used within the Puck editor.',
      );
    }
  }, [sourceToken]);

  const [isOpen, setIsOpen] = React.useState(false);
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pickerSrc = `${resolvedBasePath}/${
    encodeURIComponent(table)
  }?picker=true${
    sourceToken ? `&__cms_source=${encodeURIComponent(sourceToken)}` : ''
  }`;

  // Stash onChange in a ref so the message-listener effect doesn't re-register
  // every time Puck passes a new (non-memoized) callback.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Handle postMessage from picker iframe
  React.useEffect(() => {
    let expectedOrigin: string | null = null;

    try {
      // Derive the trusted origin from the same URL used to load the picker iframe.
      const locationHref = globalThis.location?.href;
      expectedOrigin = locationHref
        ? new URL(pickerSrc, locationHref).origin
        : null;
    } catch {
      // Fail closed: ignore all messages if we cannot determine a trusted origin.
      expectedOrigin = null;
    }

    function handleMessage(event: MessageEvent) {
      // Validate message source is our iframe (prevents spoofing from other scripts/tabs)
      if (event.source !== iframeRef.current?.contentWindow) return;
      // Validate sender origin in case the iframe window navigates unexpectedly.
      if (!expectedOrigin || event.origin !== expectedOrigin) return;

      if (event.data?.type === PICKER_MESSAGE_TYPE) {
        // The id and column come from the server (the record's real PK and
        // the real file column), not from props — see selectionFromPickerMessage.
        const selection = selectionFromPickerMessage(event.data, {
          table,
          altField,
        });
        if (selection) onChangeRef.current(selection);
        setIsOpen(false);
        dialogRef.current?.close();
      }
    }

    if (isOpen) {
      globalThis.addEventListener('message', handleMessage);
      return () => globalThis.removeEventListener('message', handleMessage);
    }
  }, [isOpen, table, altField, pickerSrc]);

  const openPicker = () => {
    setIsOpen(true);
    // Guard against re-opening an already-open dialog (showModal throws InvalidStateError)
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  };

  const closePicker = () => {
    setIsOpen(false);
    dialogRef.current?.close();
    triggerRef.current?.focus();
  };

  const clearSelection = () => {
    onChange(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {value?.id != null
        ? (
          <div style={{ position: 'relative' }}>
            <img
              src={`${resolvedBasePath}/files/${
                encodeURIComponent(value.table)
              }/${encodeURIComponent(value.column)}/${
                encodeURIComponent(String(value.id))
              }${
                value.filename ? `/${encodeURIComponent(value.filename)}` : ''
              }`}
              alt={value.alt || ''}
              style={{
                width: '100%',
                maxHeight: '200px',
                objectFit: 'contain',
                borderRadius: '4px',
                backgroundColor: '#f0f0f0',
              }}
            />
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
              {value.filename || `ID: ${value.id}`}
            </div>
          </div>
        )
        : (
          <div
            style={{
              width: '100%',
              height: '100px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f5f5f5',
              borderRadius: '4px',
              color: '#999',
            }}
          >
            No image selected
          </div>
        )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          ref={triggerRef}
          type='button'
          onClick={openPicker}
          style={{
            flex: 1,
            padding: '8px 12px',
            backgroundColor: '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          {value ? 'Change Image' : 'Pick Image'}
        </button>
        {value && (
          <button
            type='button'
            onClick={clearSelection}
            style={{
              padding: '8px 12px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Remove
          </button>
        )}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby='picker-title'
        style={{
          width: '90vw',
          maxWidth: '900px',
          height: '80vh',
          padding: 0,
          border: 'none',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
        onClose={closePicker}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid #eee',
              backgroundColor: '#f9f9f9',
            }}
          >
            <strong id='picker-title'>Select Image</strong>
            <button
              type='button'
              autoFocus
              onClick={closePicker}
              style={{
                padding: '4px 12px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                backgroundColor: 'white',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
          {isOpen && (
            <iframe
              ref={iframeRef}
              src={pickerSrc}
              style={{
                flex: 1,
                width: '100%',
                border: 'none',
              }}
              title='Image Picker'
              sandbox='allow-scripts allow-same-origin'
              referrerPolicy='no-referrer'
            />
          )}
        </div>
      </dialog>
    </div>
  );
}
