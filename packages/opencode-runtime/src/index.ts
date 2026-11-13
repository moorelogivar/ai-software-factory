import { OpenCodeCLIAdapter } from "./cli-adapter";
import { projectDirectoryResolver } from "./project-resolver";

export const openCodeExecutor = new OpenCodeCLIAdapter({
  resolveProjectDirectory: (projectId) =>
    projectDirectoryResolver.resolve(projectId),
});

export { OpenCodeCLIAdapter } from "./cli-adapter";
export { ProjectDirectoryResolver } from "./project-resolver";
