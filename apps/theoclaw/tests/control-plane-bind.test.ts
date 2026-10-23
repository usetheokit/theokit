import { describe, expect, it } from "vitest";

import { parsePort, resolveBindAddress } from "../src/control-plane/bind.js";
import { TheoClawBindError, TheoClawConfigError } from "../src/control-plane/errors.js";

/**
 * AC-001 (B-372): the control plane binds the loopback unless the operator names another address
 * AND confirms it. `resolveBindAddress` reads only the environment it is given (NFR-005), so every
 * case here passes its own object and never touches `process.env`.
 */
describe("resolveBindAddress", () => {
  it("binds the loopback when THEOCLAW_HOST is unset and HOST is 0.0.0.0", () => {
    expect(resolveBindAddress({ HOST: "0.0.0.0" })).toBe("127.0.0.1");
  });

  it("accepts ::1 and 127.0.0.2 as loopback", () => {
    expect(resolveBindAddress({ THEOCLAW_HOST: "::1" })).toBe("::1");
    expect(resolveBindAddress({ THEOCLAW_HOST: "127.0.0.2" })).toBe("127.0.0.2");
  });

  it("trims THEOCLAW_HOST and falls back to the loopback when it is blank", () => {
    expect(resolveBindAddress({ THEOCLAW_HOST: " localhost " })).toBe("localhost");
    expect(resolveBindAddress({ THEOCLAW_HOST: "   " })).toBe("127.0.0.1");
  });

  it("refuses 0.0.0.0 without THEOCLAW_PUBLIC_BIND and names the variable", () => {
    const attempt = () => resolveBindAddress({ THEOCLAW_HOST: "0.0.0.0" });

    expect(attempt).toThrow(TheoClawBindError);
    expect(attempt).toThrow(/0\.0\.0\.0.*THEOCLAW_PUBLIC_BIND=yes/);
  });

  it("binds 0.0.0.0 when THEOCLAW_PUBLIC_BIND is yes", () => {
    expect(resolveBindAddress({ THEOCLAW_HOST: "0.0.0.0", THEOCLAW_PUBLIC_BIND: "yes" })).toBe("0.0.0.0");
    expect(resolveBindAddress({ THEOCLAW_HOST: "10.0.0.1", THEOCLAW_PUBLIC_BIND: "yes" })).toBe("10.0.0.1");
  });

  it("refuses a confirmation spelled other than yes", () => {
    for (const confirmation of ["YES", " yes", "true", "1"]) {
      expect(() =>
        resolveBindAddress({ THEOCLAW_HOST: "10.0.0.1", THEOCLAW_PUBLIC_BIND: confirmation }),
      ).toThrow(TheoClawBindError);
    }
  });

  it("refuses :: and [::1] without THEOCLAW_PUBLIC_BIND", () => {
    expect(() => resolveBindAddress({ THEOCLAW_HOST: "::" })).toThrow(TheoClawBindError);
    expect(() => resolveBindAddress({ THEOCLAW_HOST: "[::1]" })).toThrow(TheoClawBindError);
  });

  it("refuses localhost.example.com and 127.0.0.1.example.com without THEOCLAW_PUBLIC_BIND", () => {
    for (const host of ["localhost.example.com", "127.0.0.1.example.com", "LOCALHOST"]) {
      expect(() => resolveBindAddress({ THEOCLAW_HOST: host })).toThrow(TheoClawBindError);
    }
  });

  it("accepts 127.255.255.255 and refuses 127.0.0.256 without THEOCLAW_PUBLIC_BIND", () => {
    expect(resolveBindAddress({ THEOCLAW_HOST: "127.255.255.255" })).toBe("127.255.255.255");
    expect(() => resolveBindAddress({ THEOCLAW_HOST: "127.0.0.256" })).toThrow(TheoClawBindError);
  });

  it("carries the refused address on the error", () => {
    try {
      resolveBindAddress({ THEOCLAW_HOST: " 10.0.0.1 " });
      expect.unreachable("a public address without the confirmation must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TheoClawBindError);
      expect((error as TheoClawBindError).address).toBe("10.0.0.1");
      expect((error as TheoClawBindError).name).toBe("TheoClawBindError");
    }
  });
});

describe("parsePort", () => {
  it("refuses a port outside 0 to 65535 and names THEOCLAW_PORT", () => {
    expect(parsePort("0")).toBe(0);
    expect(parsePort("65535")).toBe(65_535);
    for (const value of ["65536", "-1", "80a", "", undefined]) {
      expect(() => parsePort(value)).toThrow(TheoClawConfigError);
      expect(() => parsePort(value)).toThrow("THEOCLAW_PORT must be an integer from 0 to 65535");
    }
  });

  it("never echoes the refused value", () => {
    for (const value of ["not-a-port-9f3c", "987654"]) {
      try {
        parsePort(value);
        expect.unreachable("an invalid port must throw");
      } catch (error) {
        expect(String(error)).not.toContain(value);
        expect((error as TheoClawConfigError).variable).toBe("THEOCLAW_PORT");
      }
    }
  });
});
