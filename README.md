# AI Software Factory

Monorepo untuk **Autonomous AI Software Factory** — sistem yang membaca
repository, menyusun rencana, mengerjakan task, dan menjalankan agent AI
(OpenCode) secara otonom lewat CLI.

## Arsitektur

```text
ai-software-factory/
├── apps/cli/               # CLI `factory`
├── packages/
│   ├── database/           # Skema Drizzle ORM + koneksi PostgreSQL
│   ├── shared/             # Tipe data bersama antar package
│   ├── orchestrator/       # Inti orkestrasi: registry, scheduler, task/execution manager
│   └── opencode-runtime/   # Adapter CLI OpenCode + resolver folder project
├── drizzle/                # Migration SQL
└── projects/               # Project yang dikelola factory (git repo terpisah)
```

Alur satu task:

```text
backlog → queued → assigned → running → completed
                          ↓
                        failed
```

`TaskScheduler` mengambil task berstatus `queued`, mencocokkan
`input.requiredRole` dengan agent yang `idle`, lalu me-reserve agent
secara atomik. `OrchestratorCore` menjalankan agent lewat
`OpenCodeCLIAdapter`, yang menelurkan proses `opencode run --agent <n>
--format json` di dalam folder project.

## Prasyarat

- Node.js 20+ (divalidasi pada v26)
- pnpm 12+
- PostgreSQL (default port `5433`)
- Redis (default port `6379`)
- OpenCode CLI v2.3+

## Setup

```bash
pnpm install
cp .env.example .env      # isi DATABASE_URL
pnpm run db:migrate
pnpm factory agents sync   # daftarkan 6 agent ke DB + OpenCode
pnpm run typecheck
```

## Perintah CLI

> **Penting:** gunakan `pnpm factory <args>`, **bukan** `pnpm run factory -- <args>`.
> pnpm meneruskan `--` secara literal ke script, sehingga option parsing
> Commander rusak dan semua argumen dianggap positional.

```bash
pnpm factory status                          # status layanan + orchestrator
pnpm factory agents list                     # daftar agent terdaftar
pnpm factory agents sync                     # sinkronkan agent ke OpenCode

pnpm factory project create demo             # daftarkan project
pnpm factory project list                    # daftar project

pnpm factory task add demo \
  --title "Analisis arsitektur" \
  --role planner \
  --description "Ringkas struktur package"    # buat + enqueue task

pnpm factory task list demo                  # daftar task

pnpm factory run demo --once                 # 1 siklus penjadwalan, lalu keluar
pnpm factory run demo                        # loop sampai Ctrl+C
```

Role agent yang tersedia: `planner`, `architect`, `developer`, `reviewer`,
`tester`, `devops`.

## Task

Setiap task harus punya `input.requiredRole` agar scheduler tahu agent mana
yang harus menjalankan. CLI mengisi otomatis dari flag `--role`.

Task baru dibuat berstatus `backlog` lalu langsung di-`enqueue` ke `queued`,
kecuali memakai flag `--backlog`.

## Konfigurasi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `DATABASE_URL` | — | Wajib. Koneksi PostgreSQL |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Dialokasikan untuk queue |
| `OPENCODE_BIN` | `opencode` | Path binary OpenCode |
| `AI_FACTORY_PROJECTS_ROOT` | `<repo>/projects` | Akar folder project |

## Batasan yang diketahui

- **Sandboxing bersifat advisory.** Working directory agent dipaksa ke dalam
  `projectsRoot`, tetapi permission OpenCode untuk agent masih
  `read: *` — agent bisa membaca file di luar folder projectnya.
- **Redis belum dipakai.** Antrean masih memakai polling database.
- **`artifacts`, `deployments`, dan `audit_logs`** belum ditulis kode.
- **Role `orchestrator`** ada di daftar valid scheduler, tapi belum ada di
  enum database.
