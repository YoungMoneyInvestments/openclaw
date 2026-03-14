import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setVerbose } from "../globals.js";
import { createConfigIO } from "./io.js";

describe("config warning logging", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    setVerbose(false);
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dedupes repeated validation warnings and keeps full details in debug output", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-config-warning-"));
    tempDirs.push(dir);
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { list: [{ id: "main" }] },
        plugins: {
          entries: {
            ollama: {},
          },
        },
      }),
      "utf-8",
    );

    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
    const io = createConfigIO({
      configPath,
      logger: { warn, error, debug },
      env: { HOME: dir, OPENCLAW_DISABLE_DOTENV: "1" },
      homedir: () => dir,
    });

    io.loadConfig();
    io.loadConfig();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Config warnings at ${configPath}: plugins.entries.ollama`),
    );
    expect(debug).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("emits full warning details in verbose mode", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-config-warning-verbose-"));
    tempDirs.push(dir);
    const configPath = path.join(dir, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: { list: [{ id: "main" }] },
        plugins: {
          entries: {
            ollama: {},
          },
        },
      }),
      "utf-8",
    );

    setVerbose(true);
    const warn = vi.fn();
    const error = vi.fn();
    const debug = vi.fn();
    const io = createConfigIO({
      configPath,
      logger: { warn, error, debug },
      env: { HOME: dir, OPENCLAW_DISABLE_DOTENV: "1" },
      homedir: () => dir,
    });

    io.loadConfig();

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`Config warnings at ${configPath}: plugins.entries.ollama`),
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`Config warnings at ${configPath}:\n- plugins.entries.ollama:`),
    );
    expect(debug).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
