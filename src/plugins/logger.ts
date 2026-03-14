import type { PluginLogger } from "./types.js";

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};

type PluginLoaderLoggerOptions = {
  infoLevel?: "info" | "debug";
  dedupeScope?: string;
  dedupeInfo?: boolean;
  dedupeWarnings?: boolean;
};

const seenPluginStartupMessages = new Set<string>();

function shouldEmitDedupedMessage(params: {
  scope?: string;
  level: "info" | "warn";
  message: string;
  enabled: boolean;
}): boolean {
  if (!params.enabled || !params.scope) {
    return true;
  }
  const key = `${params.scope}:${params.level}:${params.message}`;
  if (seenPluginStartupMessages.has(key)) {
    return false;
  }
  seenPluginStartupMessages.add(key);
  return true;
}

export function __resetPluginLoaderLoggerStateForTests(): void {
  seenPluginStartupMessages.clear();
}

export function createPluginLoaderLogger(
  logger: LoggerLike,
  options: PluginLoaderLoggerOptions = {},
): PluginLogger {
  const infoWriter = options.infoLevel === "debug" && logger.debug ? logger.debug : logger.info;
  return {
    info: (msg) => {
      if (
        !shouldEmitDedupedMessage({
          scope: options.dedupeScope,
          level: "info",
          message: msg,
          enabled: options.dedupeInfo === true,
        })
      ) {
        return;
      }
      infoWriter(msg);
    },
    warn: (msg) => {
      if (
        !shouldEmitDedupedMessage({
          scope: options.dedupeScope,
          level: "warn",
          message: msg,
          enabled: options.dedupeWarnings === true,
        })
      ) {
        return;
      }
      logger.warn(msg);
    },
    error: (msg) => logger.error(msg),
    debug: (msg) => logger.debug?.(msg),
  };
}
