import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

beforeAll(() => {
  process.env.NODE_ENV = "test";
});

describe("API", async () => {
  const { createApp } = await import("./app.js");
  const app = createApp();

  it("reports health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("rejects invalid login and accepts configured login", async () => {
    expect((await request(app).post("/api/login").send({ username: "x", password: "x" })).status).toBe(401);
    const response = await request(app).post("/api/login").send({ username: "admin", password: "test-password" });
    expect(response.status).toBe(200);
    expect(response.body.token).toEqual(expect.any(String));
  });
});
