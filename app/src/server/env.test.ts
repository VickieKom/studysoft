import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete environment and defaults the build SHA", () => {
    expect(parseEnv(valid)).toEqual({ ...valid, BUILD_SHA: "dev" });
  });

  it("rejects a short auth secret", () => {
    expect(() => parseEnv({ ...valid, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
  });

  it("rejects a database URL that is not PostgreSQL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("names missing variables without echoing values", () => {
    expect(() => parseEnv({ AUTH_SECRET: "short" })).toThrow(/DATABASE_URL, AUTH_SECRET, APP_URL/);
  });
});
