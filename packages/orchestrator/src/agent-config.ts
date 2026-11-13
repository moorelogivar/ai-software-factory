
import type { AgentRegistration } from "../../shared/src/index";
import { AGENT_PROMPTS } from "./agent-prompts";

type AgentPermission = {
  action: string;
  resource: string;
  effect: "allow" | "ask" | "deny";
};

export interface AgentDefinition extends AgentRegistration {
  description: string;
  mode: "primary" | "subagent" | "all";
  permissions: AgentPermission[];
}

const readOnlyPermissions: AgentPermission[] = [
  { action: "*", resource: "*", effect: "deny" as const },
  { action: "read", resource: "*", effect: "allow" as const },
  { action: "glob", resource: "*", effect: "allow" as const },
  { action: "grep", resource: "*", effect: "allow" as const },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

const developerPermissions: AgentPermission[] = [
  { action: "*", resource: "*", effect: "deny" as const },
  { action: "read", resource: "*", effect: "allow" as const },
  { action: "glob", resource: "*", effect: "allow" as const },
  { action: "grep", resource: "*", effect: "allow" as const },
  { action: "edit", resource: "*", effect: "allow" as const },
  { action: "shell", resource: "*", effect: "ask" as const },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    name: "planner",
    role: "planner",
    provider: "opencode",
    model: "deepseek-v4.1-flash-free",
    description: "Breaks project requirements into actionable tasks",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.planner,
    permissions: readOnlyPermissions,
    config: { version: 1 },
  },
  {
    name: "architect",
    role: "architect",
    provider: "opencode",
    model: "big-pickle",
    description: "Designs application architecture and technical decisions",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.architect,
    permissions: readOnlyPermissions,
    config: { version: 1 },
  },
  {
    name: "developer",
    role: "developer",
    provider: "opencode",
    model: "deepseek-v4.1-flash-free",
    description: "Implements assigned application development tasks",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.developer,
    permissions: developerPermissions,
    config: { version: 1 },
  },
  {
    name: "reviewer",
    role: "reviewer",
    provider: "opencode",
    model: "glm-5.3-flash-free",
    description: "Reviews code quality, correctness and security",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.reviewer,
    permissions: readOnlyPermissions,
    config: { version: 1 },
  },
  {
    name: "tester",
    role: "tester",
    provider: "opencode",
    model: "glm-5.3-flash-free",
    description: "Analyzes test coverage and verifies application behavior",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.tester,
    permissions: readOnlyPermissions,
    config: { version: 1 },
  },
  {
    name: "devops",
    role: "devops",
    provider: "opencode",
    model: "deepseek-v4.1-flash-free",
    description: "Handles build and infrastructure configuration",
    mode: "all",
    systemPrompt: AGENT_PROMPTS.devops,
    permissions: readOnlyPermissions,
    config: { version: 1 },
  },
];
