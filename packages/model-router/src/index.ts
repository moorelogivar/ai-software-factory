// ========================================
// MODEL ROUTER
// ========================================
//
// OpenCode menyediakan banyak model gratis. Kuota tiap model terbatas
// dan bisa habis sewaktu-waktu, jadi router ini menyediakan daftar
// cadangan yang dicoba berurutan sebelum menyerah.

export interface ModelSpec {
  model: string;
  provider?: string;
}

// Model gratis yang tersedia di provider `opencode`.
// Urutan menentukan prioritas fallback.
export const FREE_OPENCODE_MODELS: ModelSpec[] = [
  { model: "deepseek-v4.1-flash-free" },
  { model: "glm-5.3-flash-free" },
  { model: "longcat-2.5-free" },
  { model: "beam-free" },
  { model: "flint-40b-free" },
  { model: "iceman-free" },
  { model: "inkling-2-small-free" },
  { model: "mimo-v2.6-flash-free" },
  { model: "minimax-m3.1-flash-free" },
  { model: "nemotron-3.5-lightning-free" },
];

export interface ModelQueueOptions {
  primary: string;
  provider: string;
  // Model cadangan. Kosongkan untuk memakai daftar model gratis.
  fallbacks?: string[];
}

// Susun antrean model: model utama duluan, lalu cadangan, tanpa duplikat.
export function buildModelQueue(
  options: ModelQueueOptions,
): string[] {
  const candidates = [
    options.primary,
    ...(options.fallbacks ?? FREE_OPENCODE_MODELS.map((m) => m.model)),
  ];

  const seen = new Set<string>();
  const queue: string[] = [];

  for (const model of candidates) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    queue.push(model);
  }

  return queue;
}

// Bentukkan referensi model lengkap `provider/model` untuk flag OpenCode.
export function toProviderModel(
  provider: string,
  model: string,
): string {
  return model.includes("/") ? model : `${provider}/${model}`;
}
