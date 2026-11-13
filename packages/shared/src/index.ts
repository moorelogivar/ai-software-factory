// Database entities
import {
  agents,
  factoryProjects,
  tasks,
  executions,
  artifacts,
  agentSessions,
  auditLogs,
  deployments,
} from "../../database/src/schema";

// ========================================
// DATABASE TYPES
// ========================================

export type FactoryProject = typeof factoryProjects.$inferSelect;
export type NewFactoryProject = typeof factoryProjects.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Execution = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;

export type Artifact = typeof artifacts.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;

// ========================================
// ENUM TYPES
// ========================================

export type AgentRole = Agent["role"];
export type AgentStatus = Agent["status"];

export type TaskStatus = Task["status"];
export type TaskPriority = Task["priority"];

export type ProjectStatus = FactoryProject["status"];
export type ExecutionStatus = Execution["status"];

// ========================================
// TASK MANAGER TYPES
// ========================================

export type CreateTaskInput = Pick<
  NewTask,
  "projectId" | "title"
> &
  Partial<
    Pick<
      NewTask,
      | "parentTaskId"
      | "description"
      | "priority"
      | "input"
      | "maxAttempts"
      | "scheduledAt"
    >
  >;

export interface TaskAssignment {
  taskId: string;
  agentId: string;
}

export interface TaskResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

// ========================================
// AGENT REGISTRY TYPES
// ========================================

export interface AgentRegistration {
  name: string;
  role: AgentRole;
  provider: string;
  model: string;
  systemPrompt?: string;
  config?: Record<string, unknown>;
}

// ========================================
// ORCHESTRATOR TYPES
// ========================================

export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  maxConcurrentAgentsPerProject: number;
  pollingIntervalMs: number;
}

export interface OrchestratorStatus {
  running: boolean;
  activeAgents: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
}
