CREATE TYPE "public"."actor_type" AS ENUM('system', 'user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."agent_role" AS ENUM('orchestrator', 'planner', 'architect', 'developer', 'reviewer', 'tester', 'devops');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('idle', 'busy', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."artifact_type" AS ENUM('source_code', 'patch', 'test_report', 'build_log', 'documentation', 'other');--> statement-breakpoint
CREATE TYPE "public"."deployment_environment" AS ENUM('preview', 'production');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('pending', 'approval_required', 'queued', 'deploying', 'ready', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('running', 'succeeded', 'failed', 'cancelled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'idle', 'closed', 'error');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('backlog', 'queued', 'assigned', 'running', 'blocked', 'review', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"task_id" uuid,
	"opencode_session_id" varchar(200) NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agent_sessions_opencode_session_id_unique" UNIQUE("opencode_session_id")
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "agent_role" NOT NULL,
	"provider" varchar(80) NOT NULL,
	"model" varchar(150) NOT NULL,
	"status" "agent_status" DEFAULT 'idle' NOT NULL,
	"system_prompt" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"execution_id" uuid,
	"type" "artifact_type" NOT NULL,
	"name" varchar(250) NOT NULL,
	"storage_path" text NOT NULL,
	"content_type" varchar(150),
	"size_bytes" integer,
	"checksum" varchar(128),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" varchar(200),
	"action" varchar(150) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(200),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"execution_id" uuid,
	"provider" varchar(80) DEFAULT 'vercel' NOT NULL,
	"environment" "deployment_environment" NOT NULL,
	"status" "deployment_status" DEFAULT 'pending' NOT NULL,
	"provider_deployment_id" varchar(200),
	"deployment_url" text,
	"commit_sha" varchar(100),
	"requested_by" varchar(200),
	"approved_by" varchar(200),
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" "execution_status" DEFAULT 'running' NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"opencode_session_id" varchar(200),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost" numeric(14, 6) DEFAULT '0' NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "executions_attempt_check" CHECK ("executions"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"assigned_agent_id" uuid,
	"title" varchar(250) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_attempts_check" CHECK ("tasks"."attempts" >= 0),
	CONSTRAINT "tasks_max_attempts_check" CHECK ("tasks"."max_attempts" > 0)
);
--> statement-breakpoint
ALTER TABLE "factory_projects" ALTER COLUMN "description" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "factory_projects" ADD COLUMN "repository_url" text;--> statement-breakpoint
ALTER TABLE "factory_projects" ADD COLUMN "repository_path" text;--> statement-breakpoint
ALTER TABLE "factory_projects" ADD COLUMN "default_branch" varchar(100) DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_projects" ADD COLUMN "status" "project_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "factory_projects" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_factory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."factory_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_factory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."factory_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_factory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."factory_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_factory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."factory_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_factory_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."factory_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_sessions_project_idx" ON "agent_sessions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_sessions_agent_status_idx" ON "agent_sessions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agents_role_idx" ON "agents" USING btree ("role");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifacts_task_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "audit_logs_project_idx" ON "audit_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deployments_project_idx" ON "deployments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deployments_environment_idx" ON "deployments" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "executions_task_idx" ON "executions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "executions_agent_idx" ON "executions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_project_status_idx" ON "tasks" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "tasks_agent_status_idx" ON "tasks" USING btree ("assigned_agent_id","status");--> statement-breakpoint
CREATE INDEX "tasks_priority_idx" ON "tasks" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "tasks_scheduled_at_idx" ON "tasks" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "factory_projects_status_idx" ON "factory_projects" USING btree ("status");