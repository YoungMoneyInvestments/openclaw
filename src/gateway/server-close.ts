import type { Server as HttpServer } from "node:http";
import type { WebSocketServer } from "ws";
import type { CanvasHostHandler, CanvasHostServer } from "../canvas-host/server.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import { stopGmailWatcher } from "../hooks/gmail-watcher.js";
import type { HeartbeatRunner } from "../infra/heartbeat-runner.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginServicesHandle } from "../plugins/services.js";

export const SHUTDOWN_STEP_TIMEOUT_MS = 10_000;

type ShutdownLogger = ReturnType<typeof createSubsystemLogger>;

async function runShutdownStep(
  name: string,
  action: () => Promise<void>,
  log?: ShutdownLogger | null,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      action(),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          log?.warn?.(`shutdown step timed out: ${name}`);
          resolve();
        }, SHUTDOWN_STEP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function closeClientSocket(socket: {
  close: (code: number, reason: string) => void;
  terminate?: () => void;
}) {
  try {
    socket.close(1012, "service restart");
  } catch {
    /* ignore */
  }
  try {
    socket.terminate?.();
  } catch {
    /* ignore */
  }
}

async function closeGatewayListeners(params: {
  clients: Set<{
    socket: { close: (code: number, reason: string) => void; terminate?: () => void };
  }>;
  wss: WebSocketServer;
  httpServer: HttpServer;
  httpServers?: HttpServer[];
}) {
  for (const socket of params.wss.clients) {
    closeClientSocket(socket);
  }
  for (const client of params.clients) {
    closeClientSocket(client.socket);
  }
  params.clients.clear();

  const wsClosed = new Promise<void>((resolve) => params.wss.close(() => resolve()));
  const servers =
    params.httpServers && params.httpServers.length > 0 ? params.httpServers : [params.httpServer];
  const httpClosed = Promise.all(
    servers.map(async (server) => {
      const httpServer = server as HttpServer & {
        closeAllConnections?: () => void;
        closeIdleConnections?: () => void;
      };
      const closed = new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
      httpServer.closeIdleConnections?.();
      httpServer.closeAllConnections?.();
      await closed;
    }),
  );

  await Promise.allSettled([wsClosed, httpClosed]);
}

export function createGatewayCloseHandler(params: {
  bonjourStop: (() => Promise<void>) | null;
  tailscaleCleanup: (() => Promise<void>) | null;
  canvasHost: CanvasHostHandler | null;
  canvasHostServer: CanvasHostServer | null;
  stopChannel: (name: ChannelId, accountId?: string) => Promise<void>;
  pluginServices: PluginServicesHandle | null;
  cron: { stop: () => void };
  heartbeatRunner: HeartbeatRunner;
  updateCheckStop?: (() => void) | null;
  nodePresenceTimers: Map<string, ReturnType<typeof setInterval>>;
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  tickInterval: ReturnType<typeof setInterval>;
  healthInterval: ReturnType<typeof setInterval>;
  dedupeCleanup: ReturnType<typeof setInterval>;
  mediaCleanup: ReturnType<typeof setInterval> | null;
  agentUnsub: (() => void) | null;
  heartbeatUnsub: (() => void) | null;
  chatRunState: { clear: () => void };
  clients: Set<{ socket: { close: (code: number, reason: string) => void } }>;
  configReloader: { stop: () => Promise<void> };
  browserControl: { stop: () => Promise<void> } | null;
  wss: WebSocketServer;
  httpServer: HttpServer;
  httpServers?: HttpServer[];
  log?: ShutdownLogger | null;
}) {
  return async (opts?: { reason?: string; restartExpectedMs?: number | null }) => {
    const reasonRaw = typeof opts?.reason === "string" ? opts.reason.trim() : "";
    const reason = reasonRaw || "gateway stopping";
    const restartExpectedMs =
      typeof opts?.restartExpectedMs === "number" && Number.isFinite(opts.restartExpectedMs)
        ? Math.max(0, Math.floor(opts.restartExpectedMs))
        : null;
    params.broadcast("shutdown", {
      reason,
      restartExpectedMs,
    });
    await closeGatewayListeners({
      clients: params.clients,
      wss: params.wss,
      httpServer: params.httpServer,
      httpServers: params.httpServers,
    });
    if (params.bonjourStop) {
      await runShutdownStep("bonjour stop", params.bonjourStop, params.log);
    }
    if (params.tailscaleCleanup) {
      await runShutdownStep("tailscale cleanup", params.tailscaleCleanup, params.log);
    }
    if (params.canvasHost) {
      await runShutdownStep("canvas host close", () => params.canvasHost!.close(), params.log);
    }
    if (params.canvasHostServer) {
      await runShutdownStep(
        "canvas host server close",
        () => params.canvasHostServer!.close(),
        params.log,
      );
    }
    await Promise.all(
      listChannelPlugins().map((plugin) =>
        runShutdownStep(
          `stop channel ${plugin.id}`,
          () => params.stopChannel(plugin.id),
          params.log,
        ),
      ),
    );
    if (params.pluginServices) {
      await runShutdownStep(
        "plugin services stop",
        () => params.pluginServices!.stop(),
        params.log,
      );
    }
    await runShutdownStep("gmail watcher stop", () => stopGmailWatcher(), params.log);
    params.cron.stop();
    params.heartbeatRunner.stop();
    try {
      params.updateCheckStop?.();
    } catch {
      /* ignore */
    }
    for (const timer of params.nodePresenceTimers.values()) {
      clearInterval(timer);
    }
    params.nodePresenceTimers.clear();
    clearInterval(params.tickInterval);
    clearInterval(params.healthInterval);
    clearInterval(params.dedupeCleanup);
    if (params.mediaCleanup) {
      clearInterval(params.mediaCleanup);
    }
    if (params.agentUnsub) {
      try {
        params.agentUnsub();
      } catch {
        /* ignore */
      }
    }
    if (params.heartbeatUnsub) {
      try {
        params.heartbeatUnsub();
      } catch {
        /* ignore */
      }
    }
    params.chatRunState.clear();
    await runShutdownStep("config reloader stop", () => params.configReloader.stop(), params.log);
    if (params.browserControl) {
      await runShutdownStep(
        "browser control stop",
        () => params.browserControl!.stop(),
        params.log,
      );
    }
  };
}
