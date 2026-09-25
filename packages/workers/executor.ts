// deno-lint-ignore-file no-console
// Worker executor
// Manages Worker instances for plugin isolation
// Compatible with Deno and Node.js 20+

import type {
  ActionContext,
  ActionHook,
  ActionHookConfig,
  AlertType,
  CrudAction,
  FieldUIOverride,
  FlashMessage,
  PluginContext,
  PluginHooks,
  PluginRouteContext,
  ResolveFlashesContext,
  Serializable,
  UIHooks,
  UIRenderFieldContext,
  UIRenderFieldFn,
  UIResolveFlashesFn,
} from './types.ts';
import { validateSerializable } from './validate.ts';

// ─────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────

/**
 * Check whether a URL is safe for use in href/src attributes.
 * Returns the URL if safe, null if unsafe.
 *
 * Allows: relative URLs (/path, ?query, #hash), http:, https:
 * Blocks: javascript:, data:, vbscript:, scheme-relative (//),
 *         control characters, and percent-encoded ASCII control characters
 *         (%00–%1F, %7F).
 *
 * NOTE: Duplicated in packages/ui/html.ts — keep in sync.
 */
function getSafeUrl(url: string): string | null {
  const input = url.trim();
  if (!input) return null;

  // Block control characters and backslashes (scheme obfuscation vectors)
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f-\x9f\\]/.test(input)) return null;
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(input)) return null;

  // Block scheme-relative URLs (//evil.com)
  if (input.startsWith('//')) return null;

  // If it has a scheme (RFC 3986: ALPHA *(ALPHA/DIGIT/"+"/"-"/".")), only allow http(s)
  if (/^[a-z][a-z0-9+\-.]*:/i.test(input)) {
    if (!/^https?:\/\//i.test(input)) return null;
  }

  return input;
}

/**
 * Validate that a value is a valid FieldUIOverride.
 * Returns a descriptive error message if invalid, null if valid.
 */
function validateFieldUIOverride(value: unknown): string | null {
  // null and undefined are valid (means "use default")
  if (value === null || value === undefined) {
    return null;
  }

  // Must be an object
  if (typeof value !== 'object') {
    return `Expected null or an object with 'link', 'valueSummary', and/or 'fileUrl', got ${typeof value}`;
  }

  // Must have at least link, valueSummary, or fileUrl
  const obj = value as Record<string, unknown>;
  if (!('link' in obj) && !('valueSummary' in obj) && !('fileUrl' in obj)) {
    return `Expected object with 'link', 'valueSummary', and/or 'fileUrl' property, got: ${
      JSON.stringify(Object.keys(obj))
    }`;
  }

  // valueSummary-only or fileUrl-only is valid (no link required)
  if (!('link' in obj)) {
    // Validate valueSummary is a string if present
    if ('valueSummary' in obj && typeof obj.valueSummary !== 'string') {
      return `Expected 'valueSummary' to be a string, got ${typeof obj
        .valueSummary}`;
    }
    // Optional: fileUrl (must be safe URL string if present)
    if ('fileUrl' in obj) {
      if (typeof obj.fileUrl !== 'string') {
        return `Expected 'fileUrl' to be a string, got ${typeof obj.fileUrl}`;
      }
      if (getSafeUrl(obj.fileUrl) === null) {
        return `Unsafe URL scheme in 'fileUrl'. Only http:, https:, and relative URLs are allowed.`;
      }
    }
    // Check for unexpected properties
    const allowedRootProps = ['valueSummary', 'fileUrl'];
    const unexpectedRootProps = Object.keys(obj).filter(
      (k) => !allowedRootProps.includes(k),
    );
    if (unexpectedRootProps.length > 0) {
      return `Unexpected properties on FieldUIOverride: ${
        JSON.stringify(unexpectedRootProps)
      }`;
    }
    return null;
  }

  const link = obj.link;
  if (typeof link !== 'object' || link === null) {
    return `Expected 'link' to be an object, got ${
      link === null ? 'null' : typeof link
    }`;
  }

  const linkObj = link as Record<string, unknown>;

  // Required: label (string)
  if (typeof linkObj.label !== 'string') {
    return `Expected 'link.label' to be a string, got ${typeof linkObj.label}`;
  }

  // Required: href (string with safe URL scheme)
  if (typeof linkObj.href !== 'string') {
    return `Expected 'link.href' to be a string, got ${typeof linkObj.href}`;
  }
  if (getSafeUrl(linkObj.href) === null) {
    return `Unsafe URL scheme in 'link.href'. Only http:, https:, and relative URLs are allowed.`;
  }

  // Optional: target (must be '_blank' if present)
  if ('target' in linkObj && linkObj.target !== '_blank') {
    return `Expected 'link.target' to be '_blank' or undefined, got ${
      JSON.stringify(linkObj.target)
    }`;
  }

  // Check for unexpected properties on link
  const allowedLinkProps = ['label', 'href', 'target'];
  const unexpectedLinkProps = Object.keys(linkObj).filter(
    (k) => !allowedLinkProps.includes(k),
  );
  if (unexpectedLinkProps.length > 0) {
    return `Unexpected properties on 'link': ${
      JSON.stringify(unexpectedLinkProps)
    }`;
  }

  // Optional: valueSummary (must be string if present)
  if ('valueSummary' in obj && typeof obj.valueSummary !== 'string') {
    return `Expected 'valueSummary' to be a string, got ${typeof obj
      .valueSummary}`;
  }

  // Optional: fileUrl (must be safe URL string if present)
  if ('fileUrl' in obj) {
    if (typeof obj.fileUrl !== 'string') {
      return `Expected 'fileUrl' to be a string, got ${typeof obj.fileUrl}`;
    }
    if (getSafeUrl(obj.fileUrl) === null) {
      return `Unsafe URL scheme in 'fileUrl'. Only http:, https:, and relative URLs are allowed.`;
    }
  }

  // Check for unexpected properties on root object
  const allowedRootProps = ['link', 'valueSummary', 'fileUrl'];
  const unexpectedRootProps = Object.keys(obj).filter(
    (k) => !allowedRootProps.includes(k),
  );
  if (unexpectedRootProps.length > 0) {
    return `Unexpected properties on FieldUIOverride: ${
      JSON.stringify(unexpectedRootProps)
    }`;
  }

  return null;
}

const FLASH_TYPES: ReadonlySet<string> = new Set<AlertType>([
  'success',
  'error',
  'info',
  'warning',
]);

/** Maximum number of flash messages a plugin may return per request. */
const MAX_FLASHES = 10;
/** Maximum length of a single flash message's text. */
const MAX_FLASH_MESSAGE_LENGTH = 500;

/**
 * Validate that a value is a valid FlashMessage[] returned from a plugin.
 * Returns the validated array on success, or an Error message string on failure.
 *
 * Unknown properties on individual flashes are ignored (forward-compat).
 * Caps array length and per-message length to prevent a misbehaving plugin
 * from blowing up the rendered page.
 */
function validateFlashes(value: unknown): FlashMessage[] | string {
  if (!Array.isArray(value)) {
    return `Expected an array of FlashMessage, got ${typeof value}`;
  }
  if (value.length > MAX_FLASHES) {
    return `Too many flashes: ${value.length} (max ${MAX_FLASHES})`;
  }
  const out: FlashMessage[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!entry || typeof entry !== 'object') {
      return `flashes[${i}] is not an object`;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.type !== 'string' || !FLASH_TYPES.has(obj.type)) {
      return `flashes[${i}].type must be one of 'success' | 'error' | 'info' | 'warning'`;
    }
    if (typeof obj.message !== 'string') {
      return `flashes[${i}].message must be a string`;
    }
    if (obj.message.length > MAX_FLASH_MESSAGE_LENGTH) {
      return `flashes[${i}].message exceeds max length of ${MAX_FLASH_MESSAGE_LENGTH} characters (got ${obj.message.length})`;
    }
    out.push({
      type: obj.type as AlertType,
      message: obj.message,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Worker message protocol
// ─────────────────────────────────────────────────────────────

/**
 * Message types for Worker communication
 */
type WorkerMessageType =
  | 'init'
  | 'transform:beforeSave'
  | 'transform:afterRead'
  | 'ui:renderField'
  | 'ui:resolveFlashes'
  | 'action'
  | 'route:render';

/**
 * Message sent to Worker
 */
interface WorkerRequest {
  id: string;
  type: WorkerMessageType;
  payload: Serializable;
}

/**
 * Response from Worker
 */
interface WorkerResponse {
  id: string;
  success: boolean;
  result?: Serializable;
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// Plugin registration types
// ─────────────────────────────────────────────────────────────

/**
 * Plugin capabilities declaration
 */
export interface PluginCapabilities {
  network?: string[];
  transforms?: ('beforeSave' | 'afterRead')[];
  actions?: ('create' | 'read' | 'update' | 'delete' | 'list')[];
  routes?: string[];
}

/**
 * Plugin configuration (flat structure).
 * Note: The full PluginConfig in handlers/plugins/types.ts also has `filter`.
 * This simplified version is used by the executor which doesn't need filter.
 *
 * For Worker plugins, `hooks` may be a declarative declaration (arrays)
 * rather than actual functions. The executor handles both patterns.
 */
export interface PluginConfig {
  name: string;
  description?: string;
  worker?: Worker;
  /**
   * For Worker plugins: declarative arrays like { on: ['create', 'update'] }
   * For in-process plugins: actual functions like { on: { create: fn } }
   */
  hooks?: PluginHooks | WorkerHookDeclaration;
  capabilities?: PluginCapabilities;
  config?: object;
}

/**
 * Declarative hook names for Worker plugins.
 * Worker plugins declare which hooks they handle; the actual functions
 * live in the Worker module, not in the main thread config.
 */
export interface WorkerHookDeclaration {
  transform?: ('beforeSave' | 'afterRead')[];
  ui?: (keyof UIHooks)[];
  on?: ('create' | 'read' | 'update' | 'delete' | 'list')[];
}

/**
 * A registered plugin with its initialization state
 */
export interface RegisteredPlugin {
  plugin: PluginConfig;
  initialized: boolean;
  /** Whether this plugin runs in a Worker */
  isWorker: boolean;
}

// ─────────────────────────────────────────────────────────────
// Worker pool management
// ─────────────────────────────────────────────────────────────

/**
 * Context for plugin error reporting
 */
export interface PluginErrorContext {
  /** Discriminator for ErrorContext union (always 'plugin') */
  source: 'plugin';
  /** Plugin name that failed */
  plugin: string;
  /** Type of operation that failed */
  operation:
    | 'init'
    | 'transform:beforeSave'
    | 'transform:afterRead'
    | 'ui:renderField'
    | 'ui:resolveFlashes'
    | 'action'
    | 'route:render'
    /** A Worker posted a message that is not a well-formed response */
    | 'message';
  /** CRUD action (for action hooks) */
  action?: CrudAction;
  /** The hook context that was active when the error occurred (varies by operation) */
  hookContext?: Serializable;
}

/**
 * Error handler callback for plugin failures
 */
export type PluginErrorHandler = (
  error: Error,
  context: PluginErrorContext,
) => void;

/**
 * Manages Worker instances for plugins.
 * Users provide their own Worker instances for full control over permissions.
 */
export class WorkerExecutor {
  private workers: Map<string, Worker> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: Serializable) => void;
    reject: (error: Error) => void;
    context: PluginErrorContext;
  }> = new Map();
  private messageIdCounter = 0;
  private onError?: PluginErrorHandler;

  constructor(onError?: PluginErrorHandler) {
    this.onError = onError;
  }

  /**
   * Initialize a Worker for a plugin.
   * Plugin must have a Worker instance provided.
   */
  async initPlugin(registered: RegisteredPlugin): Promise<void> {
    const { plugin, isWorker } = registered;

    // In-process plugins don't need Worker initialization
    if (!isWorker) {
      registered.initialized = true;
      return;
    }

    const { worker, config } = plugin;

    if (!worker) {
      throw new Error(
        `Plugin "${plugin.name}" marked as Worker plugin but has no Worker instance. ` +
          `Create one with: new Worker(import.meta.resolve('...'), { type: 'module' })`,
      );
    }

    if (this.workers.has(plugin.name)) {
      throw new Error(`Worker already initialized for plugin: ${plugin.name}`);
    }

    // A Worker instance is bound to exactly one plugin: its onmessage handler
    // carries the plugin name, and responses are only accepted from the
    // Worker a request was sent to. Sharing one instance between two plugin
    // configs would make every reply to the first plugin look forged and
    // time out, so fail fast here instead.
    for (const [existingName, existingWorker] of this.workers) {
      if (existingWorker === worker) {
        throw new Error(
          `Worker for plugin "${plugin.name}" is already registered for ` +
            `plugin "${existingName}". Each plugin needs its own Worker instance.`,
        );
      }
    }

    // Set up message handling
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerResponse(plugin.name, event.data);
    };

    // SECURITY: Log Worker errors but don't expose details
    // Prevents credential leakage via error messages
    worker.onerror = (event: ErrorEvent) => {
      console.error(`[plugin:${plugin.name}] Worker error (details hidden)`);
      // Prevent default which might expose error details
      event.preventDefault();
    };

    this.workers.set(plugin.name, worker);

    // Initialize the plugin in the Worker
    await this.sendToWorker(plugin.name, 'init', {
      plugin: this.serializePlugin(plugin),
      config: config as Serializable,
    });

    registered.initialized = true;
  }

  /**
   * Execute beforeSave transform for all plugins
   */
  async executeBeforeSave(
    plugins: RegisteredPlugin[],
    ctx: PluginContext,
    data: Record<string, Serializable>,
  ): Promise<Record<string, Serializable>> {
    let result = data;

    for (const registered of plugins) {
      const { plugin, isWorker } = registered;

      if (isWorker) {
        // Send to Worker (declarative hooks - Worker handles internally)
        const response = await this.sendToWorker(
          plugin.name,
          'transform:beforeSave',
          {
            ctx,
            data: result,
          } as unknown as Serializable,
          undefined,
          ctx as unknown as Serializable,
        );

        if (
          response && typeof response === 'object' && !Array.isArray(response)
        ) {
          result = response as Record<string, Serializable>;
        }
      } else {
        // Execute in-process hook (function form)
        const hook = this.getInProcessTransformHook(plugin.hooks, 'beforeSave');
        if (hook) {
          try {
            result = await hook(ctx, result);
          } catch (error) {
            const err = error instanceof Error
              ? error
              : new Error(String(error));
            this.onError?.(err, {
              source: 'plugin',
              plugin: plugin.name,
              operation: 'transform:beforeSave',
              hookContext: ctx as unknown as Serializable,
            });
            throw err;
          }
        }
      }
    }

    return result;
  }

  /**
   * Execute afterRead transform for all plugins
   */
  async executeAfterRead(
    plugins: RegisteredPlugin[],
    ctx: PluginContext,
    data: Record<string, Serializable>,
  ): Promise<Record<string, Serializable>> {
    let result = data;

    for (const registered of plugins) {
      const { plugin, isWorker } = registered;

      if (isWorker) {
        // Send to Worker (declarative hooks - Worker handles internally)
        const response = await this.sendToWorker(
          plugin.name,
          'transform:afterRead',
          {
            ctx,
            data: result,
          } as unknown as Serializable,
          undefined,
          ctx as unknown as Serializable,
        );

        if (
          response && typeof response === 'object' && !Array.isArray(response)
        ) {
          result = response as Record<string, Serializable>;
        }
      } else {
        // Execute in-process hook (function form)
        const hook = this.getInProcessTransformHook(plugin.hooks, 'afterRead');
        if (hook) {
          try {
            result = await hook(ctx, result);
          } catch (error) {
            const err = error instanceof Error
              ? error
              : new Error(String(error));
            this.onError?.(err, {
              source: 'plugin',
              plugin: plugin.name,
              operation: 'transform:afterRead',
              hookContext: ctx as unknown as Serializable,
            });
            throw err;
          }
        }
      }
    }

    return result;
  }

  /**
   * Get a transform hook from in-process plugin hooks (function form)
   */
  private getInProcessTransformHook(
    hooks: PluginConfig['hooks'],
    hookName: 'beforeSave' | 'afterRead',
  ):
    | ((
      ctx: PluginContext,
      data: Record<string, Serializable>,
    ) => Promise<Record<string, Serializable>> | Record<string, Serializable>)
    | undefined {
    if (!hooks) return undefined;
    // Check if it's in-process hooks (object with functions, not array)
    const transformHooks = hooks.transform;
    if (!transformHooks || Array.isArray(transformHooks)) return undefined;
    return (transformHooks as Record<
      string,
      (
        ctx: PluginContext,
        data: Record<string, Serializable>,
      ) => Promise<Record<string, Serializable>> | Record<string, Serializable>
    >)[hookName];
  }

  /**
   * Execute UI renderField hook for all plugins.
   * Returns first non-null override from any plugin, or null for default.
   */
  async executeRenderField(
    plugins: RegisteredPlugin[],
    ctx: UIRenderFieldContext,
  ): Promise<FieldUIOverride> {
    for (const registered of plugins) {
      const { plugin, isWorker } = registered;

      // Create plugin-specific context with this plugin's config extracted
      const pluginCtx: UIRenderFieldContext = {
        ...ctx,
        field: {
          ...ctx.field,
          // Extract this plugin's config from _plugins
          plugin: ctx.field._plugins?.[plugin.name],
          // Remove internal field - plugins shouldn't see other plugins' configs
          _plugins: undefined,
        },
      };

      if (isWorker) {
        // Send to Worker
        const response = await this.sendToWorker(
          plugin.name,
          'ui:renderField',
          pluginCtx as unknown as Serializable,
          undefined,
          pluginCtx as unknown as Serializable,
        );

        // Validate response
        const validationError = validateFieldUIOverride(response);
        if (validationError) {
          this.onError?.(
            new Error(
              `Plugin '${plugin.name}' returned invalid FieldUIOverride: ${validationError}`,
            ),
            {
              source: 'plugin',
              plugin: plugin.name,
              operation: 'ui:renderField',
              hookContext: pluginCtx as unknown as Serializable,
            },
          );
          // Skip this plugin, continue to next
          continue;
        }

        // If response is non-null override, return it
        if (response !== null && response !== undefined) {
          return response as FieldUIOverride;
        }
      } else {
        // Execute in-process hook
        const hook = this.getInProcessUIHook(plugin.hooks, 'renderField');
        if (hook) {
          const result = await hook(pluginCtx);

          // Validate result
          const validationError = validateFieldUIOverride(result);
          if (validationError) {
            this.onError?.(
              new Error(
                `Plugin '${plugin.name}' returned invalid FieldUIOverride: ${validationError}`,
              ),
              {
                source: 'plugin',
                plugin: plugin.name,
                operation: 'ui:renderField',
                hookContext: pluginCtx as unknown as Serializable,
              },
            );
            // Skip this plugin, continue to next
            continue;
          }

          // If non-null override, return it
          if (result !== null && result !== undefined) {
            return result;
          }
        }
      }
    }

    // No plugin returned an override
    return null;
  }

  /**
   * Get a UI hook from in-process plugin hooks (function form)
   */
  private getInProcessUIHook<H extends 'renderField' | 'resolveFlashes'>(
    hooks: PluginConfig['hooks'],
    hookName: H,
  ):
    | (H extends 'renderField' ? UIRenderFieldFn : UIResolveFlashesFn)
    | undefined {
    if (!hooks) return undefined;
    // Check if it's in-process hooks (object with functions, not array)
    const uiHooks = hooks.ui;
    if (!uiHooks || Array.isArray(uiHooks)) return undefined;
    return (uiHooks as Record<string, unknown>)[hookName] as
      | (H extends 'renderField' ? UIRenderFieldFn : UIResolveFlashesFn)
      | undefined;
  }

  /**
   * Execute UI resolveFlashes hook for all plugins.
   *
   * Plugins run in registration order; each plugin's output becomes the
   * next plugin's input.  Both Worker and in-process plugins are
   * supported \u2014 Worker plugins incur a postMessage round-trip per page.
   *
   * On invalid output or thrown errors, the prior `flashes` are carried
   * forward and the failure is reported via `onError`.  A misbehaving
   * plugin must not be able to break the page.
   */
  async executeResolveFlashes(
    plugins: RegisteredPlugin[],
    ctx: ResolveFlashesContext,
  ): Promise<FlashMessage[]> {
    let flashes = ctx.flashes;
    for (const registered of plugins) {
      const { plugin, isWorker } = registered;
      const pluginCtx: ResolveFlashesContext = { ...ctx, flashes };

      try {
        let response: unknown;
        if (isWorker) {
          response = await this.sendToWorker(
            plugin.name,
            'ui:resolveFlashes',
            pluginCtx as unknown as Serializable,
            undefined,
            pluginCtx as unknown as Serializable,
          );
        } else {
          const hook = this.getInProcessUIHook(plugin.hooks, 'resolveFlashes');
          if (!hook) continue;
          response = await hook(pluginCtx);
        }

        const result = validateFlashes(response);
        if (typeof result === 'string') {
          this.onError?.(
            new Error(
              `Plugin '${plugin.name}' returned invalid resolveFlashes response: ${result}`,
            ),
            {
              source: 'plugin',
              plugin: plugin.name,
              operation: 'ui:resolveFlashes',
              hookContext: pluginCtx as unknown as Serializable,
            },
          );
          continue;
        }
        flashes = result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.onError?.(error, {
          source: 'plugin',
          plugin: plugin.name,
          operation: 'ui:resolveFlashes',
          hookContext: pluginCtx as unknown as Serializable,
        });
        // Continue with previous flashes; one bad plugin shouldn't break the page.
      }
    }
    return flashes;
  }

  /**
   * Execute action hooks for a specific CRUD action.
   * Respects fireAndForget configuration per hook.
   */
  async executeAction(
    plugins: RegisteredPlugin[],
    action: CrudAction,
    ctx: ActionContext,
  ): Promise<void> {
    const blockingPromises: Promise<void>[] = [];
    const fireAndForgetPromises: Promise<void>[] = [];

    for (const registered of plugins) {
      const { plugin, isWorker } = registered;

      if (isWorker) {
        // Worker plugins: declarative hooks (arrays)
        // Workers default to fire-and-forget unless capabilities say otherwise
        const promise = this.executeActionHook(plugin.name, action, ctx);

        // Fire-and-forget: errors handled via onError callback in handleWorkerResponse
        fireAndForgetPromises.push(promise.catch(() => {}));
      } else {
        // In-process plugins: function hooks
        const hook = this.getInProcessActionHook(plugin.hooks, action);

        if (hook) {
          const blocking = this.isBlocking(hook);
          const handler = typeof hook === 'function' ? hook : hook.handler;

          const promise = new Promise<void>((resolve, reject) => {
            try {
              const result = handler(ctx);
              Promise.resolve(result).then(() => resolve(), reject);
            } catch (err) {
              reject(err);
            }
          });

          if (!blocking) {
            fireAndForgetPromises.push(
              promise.catch((error) => {
                // In-process plugins: call onError with full error (user's own code)
                const err = error instanceof Error
                  ? error
                  : new Error(String(error));
                this.onError?.(err, {
                  source: 'plugin',
                  plugin: plugin.name,
                  operation: 'action',
                  action,
                  hookContext: ctx as unknown as Serializable,
                });
              }),
            );
          } else {
            blockingPromises.push(
              promise.catch((error) => {
                const err = error instanceof Error
                  ? error
                  : new Error(String(error));
                this.onError?.(err, {
                  source: 'plugin',
                  plugin: plugin.name,
                  operation: 'action',
                  action,
                  hookContext: ctx as unknown as Serializable,
                });
                throw err; // Re-throw so caller can handle
              }),
            );
          }
        }
      }
    }

    // Wait for blocking hooks (re-thrown errors propagate to caller)
    await Promise.all(blockingPromises);

    // Fire-and-forget hooks run in background (not awaited)
  }

  /**
   * Get an action hook from in-process plugin hooks (function form)
   */
  private getInProcessActionHook(
    hooks: PluginConfig['hooks'],
    action: CrudAction,
  ): ActionHook | undefined {
    if (!hooks) return undefined;
    // Check if it's in-process hooks (object with functions, not array)
    const onHooks = hooks.on;
    if (!onHooks || Array.isArray(onHooks)) return undefined;
    return (onHooks as Record<string, ActionHook>)[action];
  }

  /**
   * Check if an action hook is configured as blocking (waits for completion)
   */
  private isBlocking(hook: ActionHook): boolean {
    if (typeof hook === 'function') {
      return true; // Simple function form defaults to blocking
    }
    // Default to blocking (true) if not specified
    return (hook as ActionHookConfig).blocking !== false;
  }

  /**
   * Execute a single action hook
   */
  private async executeActionHook(
    pluginName: string,
    action: CrudAction,
    ctx: ActionContext,
  ): Promise<void> {
    await this.sendToWorker(
      pluginName,
      'action',
      { action, ctx } as unknown as Serializable,
      action,
      ctx as unknown as Serializable,
    );
  }

  /**
   * Execute a plugin route render in Worker.
   * Sends context to Worker, receives HTML string back.
   *
   * @param pluginName - Plugin that owns the route
   * @param renderType - Message type to send (from route.render)
   * @param context - Route context with record data, user, etc.
   * @returns HTML string from Worker
   */
  async executeRouteRender(
    pluginName: string,
    renderType: string,
    context: PluginRouteContext,
  ): Promise<string> {
    const routePayload = {
      renderType,
      context,
    } as unknown as Serializable;
    const response = await this.sendToWorker(
      pluginName,
      'route:render',
      routePayload,
      undefined,
      routePayload,
    );

    // Worker should return { html: string }
    if (
      response &&
      typeof response === 'object' &&
      'html' in response &&
      typeof (response as { html: unknown }).html === 'string'
    ) {
      return (response as { html: string }).html;
    }

    // Invalid response
    const err = new Error(
      `Plugin '${pluginName}' route render '${renderType}' returned invalid response. ` +
        `Expected { html: string }, got: ${JSON.stringify(response)}`,
    );
    this.onError?.(err, {
      source: 'plugin',
      plugin: pluginName,
      operation: 'route:render',
      hookContext: routePayload,
    });
    throw err;
  }

  /**
   * Terminate all Workers
   */
  terminate(): void {
    for (const [name, worker] of this.workers) {
      worker.terminate();
      this.workers.delete(name);
    }
  }

  /**
   * Terminate a specific plugin's Worker
   */
  terminatePlugin(pluginName: string): void {
    const worker = this.workers.get(pluginName);
    if (worker) {
      worker.terminate();
      this.workers.delete(pluginName);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Send a message to a plugin's Worker and wait for response
   */
  private sendToWorker(
    pluginName: string,
    type: WorkerMessageType,
    payload: Serializable,
    action?: CrudAction,
    hookContext?: Serializable,
  ): Promise<Serializable> {
    const worker = this.workers.get(pluginName);
    if (!worker) {
      return Promise.reject(new Error(`No worker for plugin: ${pluginName}`));
    }

    // Validate payload is actually serializable at runtime
    // Catches functions, circular refs, Map/Set, etc. that TypeScript can't detect
    try {
      validateSerializable(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Promise.reject(
        new Error(
          `Plugin "${pluginName}" received non-serializable data: ${message}`,
        ),
      );
    }

    const id = `${pluginName}-${++this.messageIdCounter}`;

    // Build error context for this request
    const context: PluginErrorContext = {
      source: 'plugin',
      plugin: pluginName,
      operation: type === 'init'
        ? 'init'
        : type as PluginErrorContext['operation'],
      action,
      hookContext,
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        const error = new Error(`Plugin ${pluginName} timed out on ${type}`);
        this.onError?.(error, context);
        reject(error);
      }, 30000); // 30 second timeout

      // Store pending request with context
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        context,
      });

      // Send message
      const message: WorkerRequest = { id, type, payload };
      worker.postMessage(message);
    });
  }

  /**
   * Handle response from Worker.
   *
   * SECURITY: Worker error messages are passed to onError for logging
   * but NOT propagated in the thrown error. This prevents plugins from
   * leaking credentials or sensitive data via error messages to end users.
   */
  private handleWorkerResponse(
    senderPluginName: string,
    response: WorkerResponse,
  ): void {
    // A response must carry a string id and a boolean success flag before it
    // is allowed anywhere near `pendingRequests`. Checking only the id would
    // let `{ id, success: 'true' }` settle a request as successful and
    // `{ id }` reject it. Malformed messages are reported, not just logged.
    if (
      !response || typeof response !== 'object' ||
      typeof response.id !== 'string' ||
      typeof response.success !== 'boolean'
    ) {
      this.onError?.(
        new Error(
          `Plugin "${senderPluginName}" posted a malformed Worker message`,
        ),
        { source: 'plugin', plugin: senderPluginName, operation: 'message' },
      );
      return;
    }

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.warn(`Received response for unknown request: ${response.id}`);
      return;
    }

    // SECURITY: `pendingRequests` is shared by every Worker, and request ids
    // are predictable. Without this check a malicious plugin could post a
    // response carrying another plugin's request id and have its own payload
    // accepted as that plugin's beforeSave/afterRead/route result. Only the
    // Worker the request was sent to (context.plugin) may settle it; anything
    // else is reported and ignored, and the real Worker's answer is awaited.
    if (pending.context.plugin !== senderPluginName) {
      this.onError?.(
        new Error(
          `Plugin "${senderPluginName}" attempted to answer a request ` +
            `belonging to plugin "${pending.context.plugin}" (id: ${response.id})`,
        ),
        {
          source: 'plugin',
          plugin: senderPluginName,
          operation: pending.context.operation,
        },
      );
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.success) {
      pending.resolve(response.result ?? null);
    } else {
      // Create error with FULL message for onError callback
      const fullError = new Error(response.error ?? 'Unknown plugin error');

      // Call onError with full error details for server-side logging
      this.onError?.(fullError, pending.context);

      // Return sanitized error - never expose Worker error messages externally
      // This prevents credential leakage via error messages
      pending.reject(
        new Error(`Plugin "${pending.context.plugin}" execution failed`),
      );
    }
  }

  /**
   * Serialize a plugin definition for sending to Worker
   */
  private serializePlugin(plugin: PluginConfig): Serializable {
    const capabilities: Serializable | undefined = plugin.capabilities
      ? {
        network: plugin.capabilities.network,
        transforms: plugin.capabilities.transforms,
        actions: plugin.capabilities.actions,
        routes: plugin.capabilities.routes,
      }
      : undefined;

    return {
      name: plugin.name,
      description: plugin.description,
      capabilities,
    };
  }
}

/**
 * Create a Worker executor instance
 */
export function createWorkerExecutor(): WorkerExecutor {
  return new WorkerExecutor();
}
