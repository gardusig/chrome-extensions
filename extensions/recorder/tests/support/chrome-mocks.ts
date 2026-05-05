type MessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

type BeforeRequestListener = (
  details: chrome.webRequest.OnBeforeRequestDetails,
) => chrome.webRequest.BlockingResponse | void;
type CompletedListener = (details: chrome.webRequest.OnCompletedDetails) => void;

export type MockStorageShape = Record<string, unknown>;

export function createChromeMock(seed: MockStorageShape = {}): typeof chrome {
  const store = new Map<string, unknown>(Object.entries(seed));
  const runtimeListeners: MessageListener[] = [];
  const beforeRequestListeners: BeforeRequestListener[] = [];
  const completedListeners: CompletedListener[] = [];
  const startupListeners: Array<() => void> = [];
  const installedListeners: Array<() => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];

  const chromeMock = {
    runtime: {
      onMessage: {
        addListener: (listener: MessageListener) => {
          runtimeListeners.push(listener);
        },
      },
      onStartup: {
        addListener: (listener: () => void) => {
          startupListeners.push(listener);
        },
      },
      onInstalled: {
        addListener: (listener: () => void) => {
          installedListeners.push(listener);
        },
      },
      sendMessage: async (message: unknown) => {
        void message;
        return { ok: true };
      },
      openOptionsPage: async () => undefined,
    },
    webRequest: {
      onBeforeRequest: {
        addListener: (listener: BeforeRequestListener) => {
          beforeRequestListeners.push(listener);
        },
      },
      onCompleted: {
        addListener: (listener: CompletedListener) => {
          completedListeners.push(listener);
        },
      },
    },
    storage: {
      local: {
        get: async (
          keys?: string | string[] | Record<string, unknown>,
        ): Promise<Record<string, unknown>> => {
          if (!keys) {
            return Object.fromEntries(store.entries());
          }
          if (typeof keys === "string") {
            return { [keys]: store.get(keys) };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
          }
          const result: Record<string, unknown> = {};
          for (const [key, defaultValue] of Object.entries(keys)) {
            result[key] = store.has(key) ? store.get(key) : defaultValue;
          }
          return result;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value);
          }
        },
        getBytesInUse: async (keys?: string | string[]) => {
          const target = await chromeMock.storage.local.get(
            keys as string | string[] | Record<string, unknown> | undefined,
          );
          return new Blob([JSON.stringify(target)]).size;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (listener: (tabId: number) => void) => {
          tabRemovedListeners.push(listener);
        },
      },
      query: async (queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> => {
        void queryInfo;
        return [];
      },
      sendMessage: async (tabId: number, message: unknown): Promise<unknown> => {
        void tabId;
        void message;
        return { ok: true };
      },
    },
    scripting: {
      executeScript: async (injection: chrome.scripting.ScriptInjection<unknown>) => {
        void injection;
        return [];
      },
    },
    downloads: {
      download: async (options: chrome.downloads.DownloadOptions): Promise<number> => {
        void options;
        return 1;
      },
    },
  } as unknown as typeof chrome;

  (chromeMock as unknown as { __runtimeListeners: MessageListener[] }).__runtimeListeners =
    runtimeListeners;
  (
    chromeMock as unknown as { __beforeRequestListeners: BeforeRequestListener[] }
  ).__beforeRequestListeners = beforeRequestListeners;
  (chromeMock as unknown as { __completedListeners: CompletedListener[] }).__completedListeners =
    completedListeners;
  (chromeMock as unknown as { __startupListeners: Array<() => void> }).__startupListeners =
    startupListeners;
  (chromeMock as unknown as { __installedListeners: Array<() => void> }).__installedListeners =
    installedListeners;
  (
    chromeMock as unknown as { __tabRemovedListeners: Array<(tabId: number) => void> }
  ).__tabRemovedListeners = tabRemovedListeners;
  (chromeMock as unknown as { __store: Map<string, unknown> }).__store = store;

  return chromeMock;
}
