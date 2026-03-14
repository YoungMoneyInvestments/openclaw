import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.hoisted(() => vi.fn(() => ({ agents: { list: [{ id: "main" }] } })));
const resolveAgentWorkspaceDirMock = vi.hoisted(() => vi.fn(() => "/tmp/workspace"));
const resolveDefaultAgentIdMock = vi.hoisted(() => vi.fn(() => "main"));
const loadOpenClawPluginsMock = vi.hoisted(() => vi.fn());
const getActivePluginRegistryMock = vi.hoisted(() => vi.fn(() => null));
const createPluginLoaderLoggerMock = vi.hoisted(() => vi.fn((logger) => logger));

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: (...args: unknown[]) => resolveAgentWorkspaceDirMock(...args),
  resolveDefaultAgentId: (...args: unknown[]) => resolveDefaultAgentIdMock(...args),
}));

vi.mock("../plugins/loader.js", () => ({
  loadOpenClawPlugins: (...args: unknown[]) => loadOpenClawPluginsMock(...args),
}));

vi.mock("../plugins/runtime.js", () => ({
  getActivePluginRegistry: () => getActivePluginRegistryMock(),
}));

vi.mock("../plugins/logger.js", () => ({
  createPluginLoaderLogger: (...args: unknown[]) => createPluginLoaderLoggerMock(...args),
}));

vi.mock("../logging.js", () => ({
  createSubsystemLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("cli plugin registry startup logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses the filtered plugin loader logger for normal CLI startup", async () => {
    const { ensurePluginRegistryLoaded } = await import("./plugin-registry.js");

    ensurePluginRegistryLoaded();

    expect(createPluginLoaderLoggerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
        debug: expect.any(Function),
      }),
      {
        infoLevel: "debug",
        dedupeScope: "cli-startup",
        dedupeWarnings: true,
      },
    );
    expect(loadOpenClawPluginsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.any(Object),
        workspaceDir: "/tmp/workspace",
        logger: expect.any(Object),
      }),
    );
  });
});
