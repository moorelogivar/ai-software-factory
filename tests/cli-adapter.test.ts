import { describe, expect, it } from "vitest";

import { parseOutput } from "../packages/opencode-runtime/src/cli-adapter";

function line(value: unknown): string {
  return JSON.stringify(value);
}

describe("parseOutput", () => {
  it("mengambil sessionID, token, dan biaya", () => {
    const stdout = [
      line({
        type: "step_start",
        sessionID: "ses_abc",
        part: {},
      }),
      line({
        type: "step_finish",
        sessionID: "ses_abc",
        part: {
          cost: 1.5,
          tokens: { input: 120, output: 45 },
        },
      }),
    ].join("\n");

    const parsed = parseOutput(stdout);

    expect(parsed.sessionID).toBe("ses_abc");
    expect(parsed.inputTokens).toBe(120);
    expect(parsed.outputTokens).toBe(45);
    expect(parsed.cost).toBe(1.5);
  });

  it("memisahkan setiap event text dengan baris kosong", () => {
    const stdout = [
      line({
        type: "text",
        sessionID: "ses_abc",
        part: { text: "Pembuka" },
      }),
      line({
        type: "text",
        sessionID: "ses_abc",
        part: { text: "Jawaban akhir" },
      }),
    ].join("\n");

    const parsed = parseOutput(stdout);

    expect(parsed.text).toBe("Pembuka\n\nJawaban akhir");
  });

  it("mengabaikan baris yang bukan JSON valid", () => {
    const stdout = [
      "bukan json",
      line({
        type: "text",
        sessionID: "ses_abc",
        part: { text: "Teks" },
      }),
      "",
      "   ",
    ].join("\n");

    const parsed = parseOutput(stdout);

    expect(parsed.text).toBe("Teks");
    expect(parsed.events).toEqual(["text"]);
  });

  it("menangkap error OpenCode sebagai detail terstruktur", () => {
    const stdout = [
      line({
        type: "error",
        sessionID: "ses_abc",
        error: {
          type: "provider.free-limit",
          message: "Free usage limit reached",
          status: 429,
          retryAfterMs: 60000,
        },
      }),
    ].join("\n");

    const parsed = parseOutput(stdout);

    expect(parsed.error?.type).toBe("provider.free-limit");
    expect(parsed.error?.status).toBe(429);
    expect(parsed.error?.retryAfterMs).toBe(60000);
  });

  it("mengabaikan baris error yang bukan objek", () => {
    const stdout = line({
      type: "error",
      sessionID: "ses_abc",
      error: "gagal total",
    });

    const parsed = parseOutput(stdout);

    expect(parsed.error?.raw).toBe("gagal total");
  });

  it("mengembalikan daftar event untuk audit", () => {
    const stdout = [
      line({ type: "step_start", sessionID: "s", part: {} }),
      line({
        type: "tool_use",
        sessionID: "s",
        part: { tool: "read" },
      }),
      line({ type: "step_finish", sessionID: "s", part: {} }),
    ].join("\n");

    const parsed = parseOutput(stdout);

    expect(parsed.events).toEqual([
      "step_start",
      "tool_use",
      "step_finish",
    ]);
  });

  it("mengembalikan nilai kosong untuk output yang tidak terbaca", () => {
    const parsed = parseOutput("");

    expect(parsed.sessionID).toBeUndefined();
    expect(parsed.text).toBe("");
    expect(parsed.events).toEqual([]);
  });
});
