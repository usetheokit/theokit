import { describe, expect, it } from "vitest";

import { effectiveToolNames } from "@theokit/sdk";
import type { AgentOptions } from "@theokit/sdk";

import { composeTheoClaw } from "../src/composition.js";

import {
  createAgentFactory,
  createChannelAgentFactory,
  sessionAgentOptions,
  type CreateAgent,
} from "../src/control-plane/agent-factory.js";
import type { TurnAgent } from "../src/control-plane/turn.js";
import { agentToolOptions } from "../src/tools/tool-registry.js";
import { resolveToolSettings } from "../src/tools/tool-settings.js";
import { makeHostToolsWorkspace } from "./host-tools-workspace.js";
import { notEnforced } from "./tool-start-fixtures.js";
import { fakeBuilders, TELEGRAM_AND_LINE } from "./composition-fixtures.js";
import { FakeAgent, assistant, finished, messageEvent, waitFor } from "./fakes.js";

const unusedAgent: TurnAgent = { send: () => Promise.reject(new Error("not used")) };

function recordingCreate(): { create: CreateAgent; calls: Array<{ model: string; apiKey: string }> } {
  const calls: Array<{ model: string; apiKey: string }> = [];
  return {
    calls,
    create: async (options) => {
      calls.push({ model: options.model, apiKey: options.apiKey });
      return unusedAgent;
    },
  };
}

/** Keeps every option object the factory passes, whole. */
function optionsRecordingCreate(): { create: CreateAgent; options: Array<Parameters<CreateAgent>[0]> } {
  const options: Array<Parameters<CreateAgent>[0]> = [];
  return {
    options,
    create: async (passed) => {
      options.push(passed);
      return unusedAgent;
    },
  };
}

/** FR-013 (B-372): the model key goes to the SDK explicitly, resolved like the start resolves it. */
describe("createAgentFactory", () => {
  it("passes THEOKIT_API_KEY as apiKey when both keys are set", async () => {
    const { create, calls } = recordingCreate();
    const factory = createAgentFactory(
      { THEOCLAW_MODEL: " openrouter/m ", THEOKIT_API_KEY: "theokit-key", OPENROUTER_API_KEY: "router-key" },
      create,
    );

    await factory();

    expect(calls).toEqual([{ model: "openrouter/m", apiKey: "theokit-key" }]);
  });

  it("passes OPENROUTER_API_KEY as apiKey when THEOKIT_API_KEY is unset", async () => {
    const { create, calls } = recordingCreate();
    const factory = createAgentFactory({ THEOCLAW_MODEL: "openrouter/m", OPENROUTER_API_KEY: "router-key" }, create);

    await factory();

    expect(calls).toEqual([{ model: "openrouter/m", apiKey: "router-key" }]);
  });

  it("builds one agent per call", async () => {
    const { create, calls } = recordingCreate();
    const factory = createAgentFactory({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, create);

    await factory();
    await factory();

    expect(calls).toHaveLength(2);
  });

  it("withholds the shell builtin from every agent it builds", async () => {
    const { create, options } = optionsRecordingCreate();

    await createAgentFactory({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, create)();

    expect(options[0]?.withheldBuiltinTools).toEqual(["shell"]);
  });

  it("hands the tool options it is called with to the agent it creates", async () => {
    const workspace = makeHostToolsWorkspace();
    try {
      const settings = resolveToolSettings({}, workspace.path, { detect: notEnforced, warn: () => undefined });
      const { create, options } = optionsRecordingCreate();

      await createAgentFactory({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, create)(agentToolOptions(settings));

      expect(options[0]?.tools?.map((tool) => tool.name)).toContain("read_file");
      expect(options[0]?.plugins?.map((plugin) => plugin.name)).toEqual(["theoclaw-path-veto"]);
    } finally {
      workspace.remove();
    }
  });

  it("turns memory off so a turn writes no transcript under the cwd", async () => {
    const { create, options } = optionsRecordingCreate();

    await createAgentFactory({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, create)();

    expect(options[0]?.memory).toEqual({ enabled: false });
  });

  it("refuses to build an agent without a model or a key", async () => {
    const { create, calls } = recordingCreate();

    await expect(createAgentFactory({ OPENROUTER_API_KEY: "k" }, create)()).rejects.toThrow("THEOCLAW_MODEL");
    await expect(createAgentFactory({ THEOCLAW_MODEL: "m" }, create)()).rejects.toThrow("OPENROUTER_API_KEY");
    expect(calls).toHaveLength(0);
  });
});

/**
 * A chat reply runs on whatever anyone sent the bot. The SDK's local agent declares a `shell` tool
 * by default (`sh -c` in the process's directory, with no permission gate), so a channel agent must
 * be built without it. `effectiveToolNames` is the SDK's own reading of what an agent built from
 * those options offers the model.
 */
describe("createChannelAgentFactory", () => {
  it("builds the agent of a chat reply with no tool at all, the shell included", async () => {
    const { create, options } = optionsRecordingCreate();

    await createChannelAgentFactory({ THEOCLAW_MODEL: "openrouter/m", OPENROUTER_API_KEY: "router-key" }, create)();

    expect(options).toHaveLength(1);
    const catalog = effectiveToolNames({ ...options[0] });
    expect(catalog.names).toEqual([]);
    expect(catalog.unresolved).toEqual([]);
    expect(options[0]).toMatchObject({ model: "openrouter/m", apiKey: "router-key" });
  });

  it("turns memory off so a chat reply writes no transcript under the cwd", async () => {
    const { create, options } = optionsRecordingCreate();

    await createChannelAgentFactory({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, create)();

    expect(options[0]?.memory).toEqual({ enabled: false });
  });
});

/**
 * The options the chat path passes for one chat reply's agent, read where it passes them: one
 * message through `composeTheoClaw`, whose session agents `getOrCreate` opens through
 * `createChannelAgentFactory` (plan T5.1). The same two guarantees as above, end to end.
 */
function chatPathRecording(): {
  create: (env: Readonly<Record<string, string | undefined>>) => () => Promise<void>;
  options: AgentOptions[];
} {
  const options: AgentOptions[] = [];
  const create = (env: Readonly<Record<string, string | undefined>>) => async (): Promise<void> => {
    const { adapters, builders } = fakeBuilders();
    const { loop, sessions } = composeTheoClaw({
      env: { THEOCLAW_TELEGRAM_TOKEN: TELEGRAM_AND_LINE.THEOCLAW_TELEGRAM_TOKEN, THEOCLAW_WORKSPACE: TELEGRAM_AND_LINE.THEOCLAW_WORKSPACE, ...env },
      agentFactory: () => unusedAgent,
      getOrCreate: async (_id, passed) => {
        options.push(passed);
        return Object.assign(new FakeAgent({ frames: [assistant("ok"), finished()] }), { dispose: async () => undefined });
      },
      builders,
      write: () => undefined,
    });
    await loop.ready;
    const telegram = adapters.get("telegram")!;
    await telegram.deliver(messageEvent("telegram", "hello"));
    await waitFor(() => telegram.sent.length === 1, 1000, "the chat reply");
    await loop.stopAll();
    await sessions.disposeAll();
  };
  return { create, options };
}

/** B-377's two guarantees, read on the options `composeTheoClaw` passes to `getOrCreate`. */
describe("the chat path's agent options", () => {
  it("builds the agent of a chat reply with no tool at all, the shell included", async () => {
    const { create, options } = chatPathRecording();

    await create({ THEOCLAW_MODEL: "openrouter/m", OPENROUTER_API_KEY: "router-key" })();

    expect(options).toHaveLength(1);
    const catalog = effectiveToolNames({ ...options[0] });
    expect(catalog.names).toEqual([]);
    expect(catalog.unresolved).toEqual([]);
    expect(options[0]).toMatchObject({ model: "openrouter/m", apiKey: "router-key" });
  });

  it("turns memory off so a chat reply writes no transcript under the cwd", async () => {
    const { create, options } = chatPathRecording();

    await create({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" })();

    expect(options[0]?.memory).toEqual({ enabled: false });
  });
});

describe("sessionAgentOptions", () => {
  it("keeps the transcripts under the workspace", () => {
    expect(sessionAgentOptions({ THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: "k" }, "/ws").local).toEqual({
      cwd: "/ws",
      sessionDir: "/ws/.theoclaw",
    });
  });

  it("refuses a missing model with the start's own words", () => {
    expect(() => sessionAgentOptions({ OPENROUTER_API_KEY: "k" }, "/ws")).toThrow("THEOCLAW_MODEL");
  });
});
