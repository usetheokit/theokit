import { describe, expect, it } from "vitest";

import { TheoClawBindError, TheoClawConfigError } from "../src/control-plane/errors.js";
import { readControlPlaneSettings, resolveModelKey } from "../src/control-plane/settings.js";

const MODEL_KEY = "model-key-value-5d1e8c";
const TOKEN = "control-token-value-0123456789abcdef"; // 36 characters

/** A complete environment; each refusal test removes or spoils exactly one variable. */
function validEnv(): Record<string, string | undefined> {
  return {
    THEOCLAW_MODEL: "openrouter/some/model",
    OPENROUTER_API_KEY: MODEL_KEY,
    THEOCLAW_PORT: "0",
    THEOCLAW_CONTROL_TOKEN: TOKEN,
  };
}

function refusal(env: Record<string, string | undefined>): Error {
  try {
    readControlPlaneSettings(env);
  } catch (error) {
    return error as Error;
  }
  throw new Error("readControlPlaneSettings accepted an environment it must refuse");
}

/** AC-003 (B-372): every bad value is refused before anything opens, by name, never by value. */
describe("readControlPlaneSettings", () => {
  it("reads a complete environment", () => {
    expect(readControlPlaneSettings(validEnv())).toEqual({
      host: "127.0.0.1",
      port: 0,
      model: "openrouter/some/model",
      modelKey: MODEL_KEY,
      controlToken: TOKEN,
    });
  });

  it("refuses a start without THEOCLAW_MODEL and names the variable", () => {
    for (const model of [undefined, "   "]) {
      const error = refusal({ ...validEnv(), THEOCLAW_MODEL: model });
      expect(error).toBeInstanceOf(TheoClawConfigError);
      expect(error.message).toContain("THEOCLAW_MODEL");
      expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
    }
  });

  it("refuses a start without a model key and names both variables", () => {
    const error = refusal({ ...validEnv(), OPENROUTER_API_KEY: undefined, THEOKIT_API_KEY: " " });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect(error.message).toContain("THEOKIT_API_KEY");
    expect(error.message).toContain("OPENROUTER_API_KEY");
    expect(error.message).not.toContain("THEOCLAW_MODEL");
    expect((error as TheoClawConfigError).variable).toBe("THEOKIT_API_KEY");
  });

  it("refuses a start without THEOCLAW_PORT and names the variable", () => {
    const error = refusal({ ...validEnv(), THEOCLAW_PORT: undefined });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_PORT");
    expect(error.message).toContain("THEOCLAW_PORT");
    // The key was read before the port failed; the refusal must still not carry it.
    expect(String(error)).not.toContain(MODEL_KEY);
  });

  it("refuses a control token shorter than 32 characters without printing it", () => {
    const shortToken = "tok-abcdefghijklmnopqrstuvwxyz1"; // 31 characters
    const error = refusal({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: shortToken });
    expect(error).toBeInstanceOf(TheoClawConfigError);
    expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_CONTROL_TOKEN");
    expect(error.message).not.toContain(shortToken);
    expect(String(error)).not.toContain(shortToken);
  });

  it("accepts a control token of exactly 32 characters", () => {
    const token = "x".repeat(32);
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: token }).controlToken).toBe(token);
  });

  it("leaves the control socket off when THEOCLAW_CONTROL_TOKEN is unset or empty", () => {
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: undefined }).controlToken).toBeUndefined();
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: "" }).controlToken).toBeUndefined();
  });

  it("refuses a public bind last, after every other value was read", () => {
    expect(refusal({ ...validEnv(), THEOCLAW_HOST: "0.0.0.0" })).toBeInstanceOf(TheoClawBindError);
    const earlier = refusal({ ...validEnv(), THEOCLAW_HOST: "0.0.0.0", THEOCLAW_MODEL: undefined });
    expect((earlier as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
  });

  it("checks the model, the key, the port and the token in that order", () => {
    const allBad = { THEOCLAW_CONTROL_TOKEN: "short", THEOCLAW_PORT: "x" };
    expect((refusal(allBad) as TheoClawConfigError).variable).toBe("THEOCLAW_MODEL");
    expect((refusal({ ...allBad, THEOCLAW_MODEL: "m" }) as TheoClawConfigError).variable).toBe("THEOKIT_API_KEY");
    expect(
      (refusal({ ...allBad, THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: MODEL_KEY }) as TheoClawConfigError).variable,
    ).toBe("THEOCLAW_PORT");
    expect(
      (refusal({ ...allBad, THEOCLAW_MODEL: "m", OPENROUTER_API_KEY: MODEL_KEY, THEOCLAW_PORT: "0" }) as TheoClawConfigError)
        .variable,
    ).toBe("THEOCLAW_CONTROL_TOKEN");
  });

  it("refuses a control token padded with whitespace without printing it", () => {
    for (const token of [" ".repeat(32), `${TOKEN}\n`]) {
      const error = refusal({ ...validEnv(), THEOCLAW_CONTROL_TOKEN: token });
      expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_CONTROL_TOKEN");
      expect(String(error)).not.toContain(TOKEN);
    }
  });
});

describe("resolveModelKey", () => {
  it("prefers THEOKIT_API_KEY and falls back to OPENROUTER_API_KEY when it is blank", () => {
    expect(resolveModelKey({ THEOKIT_API_KEY: "a", OPENROUTER_API_KEY: "b" })).toBe("a");
    expect(resolveModelKey({ THEOKIT_API_KEY: " ", OPENROUTER_API_KEY: "b" })).toBe("b");
    expect(resolveModelKey({})).toBeUndefined();
  });
});
