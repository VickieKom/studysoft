import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/client";
import { createServerCaller } from "../router";
import { authRequest, signedInHeaders } from "../testing/requests";
import { createTeacher } from "./teachers";

afterAll(closeDb);

describe("createTeacher", () => {
  const account = { name: "Новый учитель", email: "created-teacher@example.test", password: "first-password-123" };

  it("creates an account that signs in with its password", async () => {
    const created = await createTeacher(db(), account);
    expect(created).not.toBeNull();

    const caller = createServerCaller(await signedInHeaders(account));
    expect((await caller.teacher.session.me()).id).toBe(created!.id);
  });

  it("leaves an existing account and its password as they are", async () => {
    expect(await createTeacher(db(), { ...account, password: "another-password-456" })).toBeNull();

    const rejected = await authRequest("/sign-in/email", { email: account.email, password: "another-password-456" });
    expect(rejected.ok).toBe(false);
    await expect(signedInHeaders(account)).resolves.toBeInstanceOf(Headers);
  });
});
