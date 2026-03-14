import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPluginLoaderLoggerStateForTests, createPluginLoaderLogger } from "./logger.js";

describe("plugins/logger", () => {
  beforeEach(() => {
    __resetPluginLoaderLoggerStateForTests();
  });

  it("forwards logger methods", () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
    const logger = createPluginLoaderLogger({ info, warn, error, debug });

    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug?.("d");

    expect(info).toHaveBeenCalledWith("i");
    expect(warn).toHaveBeenCalledWith("w");
    expect(error).toHaveBeenCalledWith("e");
    expect(debug).toHaveBeenCalledWith("d");
  });

  it("dedupes repeated warnings within a scope and routes info to debug when requested", () => {
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
    const logger = createPluginLoaderLogger(
      { info, warn, error, debug },
      {
        infoLevel: "debug",
        dedupeScope: "gateway-startup",
        dedupeWarnings: true,
      },
    );

    logger.info("plugin startup detail");
    logger.warn("plugins.allow is empty");
    logger.warn("plugins.allow is empty");
    logger.error("plugin exploded");

    expect(info).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("plugin startup detail");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("plugins.allow is empty");
    expect(error).toHaveBeenCalledWith("plugin exploded");
  });
});
