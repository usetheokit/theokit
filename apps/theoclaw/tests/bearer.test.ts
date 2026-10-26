import { describe, expect, it } from "vitest";

import { bearerCheck, MIN_BEARER_TOKEN_LENGTH, readBearerToken } from "../src/control-plane/bearer.js";
import { TheoClawConfigError } from "../src/control-plane/errors.js";
import { readControlPlaneSettings } from "../src/control-plane/settings.js";

const TOKEN = "t".repeat(32);
const WEBCHAT_TOKEN = "w".repeat(40);

function refusalOf(read: () => unknown): TheoClawConfigError {
  try {
    read();
  } catch (error) {
    if (error instanceof TheoClawConfigError) return error;
    throw error;
  }
  throw new Error("the read accepted a value it must refuse");
}

function validEnv(): Record<string, string | undefined> {
  return {
    THEOCLAW_MODEL: "openrouter/some/model",
    OPENROUTER_API_KEY: "sk-or-key",
    THEOCLAW_PORT: "0",
  };
}

/** AC-001 (B-368): one bearer comparison serves `/control` and `/webchat`. */
describe("bearerCheck", () => {
  const accepts = bearerCheck(TOKEN);

  it("refuses a missing header", () => {
    expect(accepts(undefined)).toBe(false);
    expect(accepts("")).toBe(false);
  });

  it("refuses a wrong token", () => {
    expect(accepts(`Bearer ${"x".repeat(32)}`)).toBe(false);
    expect(accepts(`Bearer ${TOKEN}x`)).toBe(false);
  });

  it("refuses a scheme other than Bearer", () => {
    expect(accepts(`Basic ${TOKEN}`)).toBe(false);
    expect(accepts(TOKEN)).toBe(false);
  });

  it("accepts the right token with any case of the scheme", () => {
    for (const scheme of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
      expect(accepts(`${scheme} ${TOKEN}`)).toBe(true);
    }
  });

  it("refuses a token followed by a trailing space (EC-7)", () => {
    expect(accepts(`Bearer ${TOKEN} `)).toBe(false);
  });

  it("refuses a double space after the scheme (EC-7)", () => {
    expect(accepts(`Bearer  ${TOKEN}`)).toBe(false);
  });
});

describe("readBearerToken", () => {
  it("returns undefined for an unset or empty variable", () => {
    expect(readBearerToken({}, "SOME_TOKEN")).toBeUndefined();
    expect(readBearerToken({ SOME_TOKEN: "" }, "SOME_TOKEN")).toBeUndefined();
  });

  it("returns a token of the minimum length as it is", () => {
    expect(readBearerToken({ SOME_TOKEN: TOKEN }, "SOME_TOKEN")).toBe(TOKEN);
  });

  it("refuses a padded value naming the variable and not the value", () => {
    const padded = ` ${TOKEN}`;
    const error = refusalOf(() => readBearerToken({ SOME_TOKEN: padded }, "SOME_TOKEN"));
    expect(error.variable).toBe("SOME_TOKEN");
    expect(error.message).toContain("SOME_TOKEN");
    expect(error.message).toContain("whitespace");
    expect(error.message).not.toContain(TOKEN);
  });

  it("refuses a 31-character value naming the variable and not the value", () => {
    const short = "s".repeat(MIN_BEARER_TOKEN_LENGTH - 1);
    const error = refusalOf(() => readBearerToken({ SOME_TOKEN: short }, "SOME_TOKEN"));
    expect(error.variable).toBe("SOME_TOKEN");
    expect(error.message).toContain(`at least ${MIN_BEARER_TOKEN_LENGTH} characters`);
    expect(error.message).not.toContain(short);
  });

  it("sets the minimum at 32 characters", () => {
    expect(MIN_BEARER_TOKEN_LENGTH).toBe(32);
  });
});

describe("readControlPlaneSettings and the WebChat token", () => {
  it("reads THEOCLAW_WEBCHAT_TOKEN into webchatToken", () => {
    const settings = readControlPlaneSettings({ ...validEnv(), THEOCLAW_WEBCHAT_TOKEN: WEBCHAT_TOKEN });
    expect(settings.webchatToken).toBe(WEBCHAT_TOKEN);
  });

  it("leaves webchatToken undefined while THEOCLAW_WEBCHAT_TOKEN is unset or empty", () => {
    expect(readControlPlaneSettings(validEnv()).webchatToken).toBeUndefined();
    expect(readControlPlaneSettings({ ...validEnv(), THEOCLAW_WEBCHAT_TOKEN: "" }).webchatToken).toBeUndefined();
  });

  it("refuses a 31-character THEOCLAW_WEBCHAT_TOKEN naming the variable", () => {
    const short = "w".repeat(31);
    const error = refusalOf(() => readControlPlaneSettings({ ...validEnv(), THEOCLAW_WEBCHAT_TOKEN: short }));
    expect(error.variable).toBe("THEOCLAW_WEBCHAT_TOKEN");
    expect(error.message).toContain("THEOCLAW_WEBCHAT_TOKEN");
    expect(error.message).not.toContain(short);
  });
});
