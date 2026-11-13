import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

// ENUMS

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "paused",
  "archived",
]);

export const agentRoleEnum = pgEnum("agent_role", [
  "orchestrator",
  "planner",
  "architect",
  "developer",
  "reviewer",
  "tester",
  "devops",
]);

export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "busy",
  "disabled",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "queued",
  "assigned",
  "running",
  "blocked",
  "review",
  "completed",
  "failed",
  "cancelled",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const executionStatusEnum = pgEnum("execution_status", [
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export const artifactTypeEnum = pgEnum("artifact_type", [
  "source_code",
  "patch",
  "test_report",
  "build_log",
  "documentation",
  "other",
]);

export const sessionStatusEnum = pgEnum("session_status", [
  "active",
  "idle",
  "closed",
  "error",
]);

export const deploymentEnvironmentEnum = pgEnum("deployment_environment", [
  "preview",
  "production",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "approval_required",
  "queued",
  "deploying",
  "ready",
  "failed",
  "cancelled",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "system",
  "user",
  "agent",
]);

// 1. PROJECTS

export const factoryProjects = pgTable(
  "factory_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 150 }).notNull(),
    slug: varchar("slug", { length: 150 }).notNull().unique(),
    description: text("description"),
    repositoryUrl: text("repository_url"),
    repositoryPath: text("repository_path"),
    defaultBranch: varchar("default_branch", { length: 100 })
      .default("main")
      .notNull(),
    status: projectStatusEnum("status").default("active").notNull(),
    config: jsonb("config").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("factory_projects_status_idx").on(table.status),
  ],
);

// 2. AGENTS

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    role: agentRoleEnum("role").notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    model: varchar("model", { length: 150 }).notNull(),
    status: agentStatusEnum("status").default("idle").notNull(),
    systemPrompt: text("system_prompt"),
    config: jsonb("config").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("agents_role_idx").on(table.role),
    index("agents_status_idx").on(table.status),
  ],
);

// 3. TASKS

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
    onDelete: "set null",
  }),
    assignedAgentId: uuid("assigned_agent_id")
      .references(() => agents.id, { onDelete: "set null" }),
    title: varchar("title", { length: 250 }).notNull(),
    description: text("description"),
    status: taskStatusEnum("status").default("backlog").notNull(),
    priority: taskPriorityEnum("priority").default("normal").notNull(),
    input: jsonb("input").default({}).notNull(),
    result: jsonb("result"),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("tasks_project_status_idx").on(table.projectId, table.status),
    index("tasks_agent_status_idx").on(table.assignedAgentId, table.status),
    index("tasks_priority_idx").on(table.priority),
    index("tasks_scheduled_at_idx").on(table.scheduledAt),
    check("tasks_attempts_check", sql`${table.attempts} >= 0`),
    check("tasks_max_attempts_check", sql`${table.maxAttempts} > 0`),
  ],
);

// 4. EXECUTIONS

export const executions = pgTable(
  "executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .references(() => agents.id, { onDelete: "set null" }),
    status: executionStatusEnum("status").default("running").notNull(),
    attemptNumber: integer("attempt_number").default(1).notNull(),
    opencodeSessionId: varchar("opencode_session_id", { length: 200 }),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    cost: numeric("cost", { precision: 14, scale: 6 }).default("0").notNull(),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").default({}).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("executions_task_idx").on(table.taskId),
    index("executions_agent_idx").on(table.agentId),
    index("executions_status_idx").on(table.status),
    check("executions_attempt_check", sql`${table.attemptNumber} > 0`),
  ],
);

// 5. ARTIFACTS

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "set null" }),
    executionId: uuid("execution_id")
      .references(() => executions.id, { onDelete: "set null" }),
    type: artifactTypeEnum("type").notNull(),
    name: varchar("name", { length: 250 }).notNull(),
    storagePath: text("storage_path").notNull(),
    contentType: varchar("content_type", { length: 150 }),
    sizeBytes: integer("size_bytes"),
    checksum: varchar("checksum", { length: 128 }),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("artifacts_project_idx").on(table.projectId),
    index("artifacts_task_idx").on(table.taskId),
    check("artifacts_size_bytes_check", sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`)
  ],
);

// 6. AGENT SESSIONS

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "set null" }),
    opencodeSessionId: varchar("opencode_session_id", { length: 200 })
      .notNull().unique(),
    status: sessionStatusEnum("status").default("active").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_sessions_project_idx").on(table.projectId),
    index("agent_sessions_agent_status_idx").on(table.agentId, table.status),
  ],
);

// 7. AUDIT LOGS

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => factoryProjects.id, { onDelete: "set null" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 200 }),
    action: varchar("action", { length: 150 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }).notNull(),
    entityId: varchar("entity_id", { length: 200 }),
    details: jsonb("details").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_project_idx").on(table.projectId),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

// 8. DEPLOYMENTS

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => factoryProjects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .references(() => tasks.id, { onDelete: "set null" }),
    executionId: uuid("execution_id")
      .references(() => executions.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 80 }).default("vercel").notNull(),
    environment: deploymentEnvironmentEnum("environment").notNull(),
    status: deploymentStatusEnum("status").default("pending").notNull(),
    providerDeploymentId: varchar("provider_deployment_id", { length: 200 }),
    deploymentUrl: text("deployment_url"),
    commitSha: varchar("commit_sha", { length: 100 }),
    requestedBy: varchar("requested_by", { length: 200 }),
    approvedBy: varchar("approved_by", { length: 200 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow().notNull(),
  },
  (table) => [
    index("deployments_project_idx").on(table.projectId),
    index("deployments_status_idx").on(table.status),
    index("deployments_environment_idx").on(table.environment),
  ],
);
