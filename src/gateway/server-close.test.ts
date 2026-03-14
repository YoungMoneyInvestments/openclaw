import { describe, expect, it, vi } from "vitest";

const listChannelPluginsMock = vi.hoisted(() => vi.fn(() => [{ id: "telegram" }]));
const stopGmailWatcherMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => listChannelPluginsMock(),
}));

vi.mock("../hooks/gmail-watcher.js", () => ({
  stopGmailWatcher: () => stopGmailWatcherMock(),
}));

describe("createGatewayCloseHandler", () => {
  it("quiesces websocket and http listeners before awaiting slow channel shutdown", async () => {
    const { createGatewayCloseHandler } = await import("./server-close.js");

    let releaseStopChannel: (() => void) | null = null;
    const stopChannel = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          releaseStopChannel = resolve;
        }),
    );

    const preauthSocket = {
      close: vi.fn(),
      terminate: vi.fn(),
    };
    const trackedSocket = {
      close: vi.fn(),
      terminate: vi.fn(),
    };
    const wss = {
      clients: new Set([preauthSocket]),
      close: vi.fn((cb: () => void) => cb()),
    };
    const httpServer = {
      close: vi.fn((cb: (err?: Error) => void) => cb()),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const tickInterval = setInterval(() => {}, 60_000);
    const healthInterval = setInterval(() => {}, 60_000);
    const dedupeCleanup = setInterval(() => {}, 60_000);

    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel,
      pluginServices: null,
      cron: { stop: vi.fn() },
      heartbeatRunner: { stop: vi.fn() },
      updateCheckStop: null,
      nodePresenceTimers: new Map(),
      broadcast: vi.fn(),
      tickInterval,
      healthInterval,
      dedupeCleanup,
      mediaCleanup: null,
      agentUnsub: null,
      heartbeatUnsub: null,
      chatRunState: { clear: vi.fn() },
      clients: new Set([{ socket: trackedSocket }]),
      configReloader: { stop: vi.fn(async () => {}) },
      browserControl: null,
      wss: wss as never,
      httpServer: httpServer as never,
      log: log as never,
    });

    const closePromise = close({ reason: "gateway restarting", restartExpectedMs: 1500 });
    await Promise.resolve();

    expect(wss.close).toHaveBeenCalledTimes(1);
    expect(httpServer.close).toHaveBeenCalledTimes(1);
    expect(httpServer.closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(httpServer.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(preauthSocket.close).toHaveBeenCalledWith(1012, "service restart");
    expect(trackedSocket.close).toHaveBeenCalledWith(1012, "service restart");
    expect(log.info).toHaveBeenCalledWith(
      "shutdown: starting (gateway restarting; restartExpectedMs=1500)",
    );
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith("shutdown: listeners quiesced");
    });
    await vi.waitFor(() => {
      expect(stopChannel).toHaveBeenCalledWith("telegram");
    });

    releaseStopChannel?.();
    await closePromise;
    await vi.waitFor(() => {
      expect(log.info).toHaveBeenCalledWith("shutdown: cleanup complete");
    });
  });

  it("times out a stuck shutdown step and still resolves close", async () => {
    vi.useFakeTimers();
    const { SHUTDOWN_STEP_TIMEOUT_MS, createGatewayCloseHandler } =
      await import("./server-close.js");

    const log = {
      warn: vi.fn(),
    };
    const stopChannel = vi.fn(
      async () =>
        await new Promise<void>(() => {
          // Never resolves.
        }),
    );
    const wss = {
      clients: new Set(),
      close: vi.fn((cb: () => void) => cb()),
    };
    const httpServer = {
      close: vi.fn((cb: (err?: Error) => void) => cb()),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const tickInterval = setInterval(() => {}, 60_000);
    const healthInterval = setInterval(() => {}, 60_000);
    const dedupeCleanup = setInterval(() => {}, 60_000);

    const close = createGatewayCloseHandler({
      bonjourStop: null,
      tailscaleCleanup: null,
      canvasHost: null,
      canvasHostServer: null,
      stopChannel,
      pluginServices: null,
      cron: { stop: vi.fn() },
      heartbeatRunner: { stop: vi.fn() },
      updateCheckStop: null,
      nodePresenceTimers: new Map(),
      broadcast: vi.fn(),
      tickInterval,
      healthInterval,
      dedupeCleanup,
      mediaCleanup: null,
      agentUnsub: null,
      heartbeatUnsub: null,
      chatRunState: { clear: vi.fn() },
      clients: new Set(),
      configReloader: { stop: vi.fn(async () => {}) },
      browserControl: null,
      wss: wss as never,
      httpServer: httpServer as never,
      log: log as never,
    });

    const closePromise = close();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_STEP_TIMEOUT_MS);
    await closePromise;

    expect(log.warn).toHaveBeenCalledWith("shutdown step timed out: stop channel telegram");
    expect(wss.close).toHaveBeenCalledTimes(1);
    expect(httpServer.close).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
