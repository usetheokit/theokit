import { describe, expect, it } from "vitest";

import { createAgentFactory, type CreateAgent } from "../src/control-plane/agent-factory.js";
import type { TurnAgent } from "../src/control-plane/turn.js";

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
