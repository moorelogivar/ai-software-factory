import { describe, expect, it } from "vitest";

import {
  FREE_OPENCODE_MODELS,
  buildModelQueue,
  toProviderModel,
} from "../packages/model-router/src/index";

describe("buildModelQueue", () => {
  it("meletakkan model utama di urutan pertama", () => {
    const queue = buildModelQueue({
      primary: "glm-5.3-flash-free",
      provider: "opencode",
      fallbacks: ["deepseek-v4.1-flash-free", "longcat-2.5-free"],
    });

    expect(queue[0]).toBe("glm-5.3-flash-free");
  });

  it("menghapus model yang duplikat", () => {
    const queue = buildModelQueue({
      primary: "glm-5.3-flash-free",
      provider: "opencode",
      fallbacks: ["glm-5.3-flash-free", "longcat-2.5-free"],
    });

    expect(queue).toEqual([
      "glm-5.3-flash-free",
      "longcat-2.5-free",
    ]);
  });

  it("memakai daftar model gratis bila fallback tidak diberikan", () => {
    const queue = buildModelQueue({
      primary: "custom-model",
      provider: "opencode",
    });

    expect(queue[0]).toBe("custom-model");
    expect(queue.length).toBe(
      FREE_OPENCODE_MODELS.length + 1,
    );
  });

  it("selalu berisi setidaknya satu model", () => {
    const queue = buildModelQueue({
      primary: "custom-model",
      provider: "opencode",
      fallbacks: [],
    });

    expect(queue).toEqual(["custom-model"]);
  });

  it("mengabaikan model kosong", () => {
    const queue = buildModelQueue({
      primary: "custom-model",
      provider: "opencode",
      fallbacks: ["", "longcat-2.5-free"],
    });

    expect(queue).toEqual(["custom-model", "longcat-2.5-free"]);
  });
});

describe("toProviderModel", () => {
  it("menambahkan provider bila belum ada", () => {
    expect(toProviderModel("opencode", "deepseek-v4.1-flash-free"))
      .toBe("opencode/deepseek-v4.1-flash-free");
  });

  it("membiarkan model yang sudah lengkap", () => {
    expect(toProviderModel("opencode", "opencode/deepseek-v4.1-flash-free"))
      .toBe("opencode/deepseek-v4.1-flash-free");
  });
});

describe("FREE_OPENCODE_MODELS", () => {
  it("berisi model gratis yang unik", () => {
    const names = FREE_OPENCODE_MODELS.map((m) => m.model);

    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);
  });
});
