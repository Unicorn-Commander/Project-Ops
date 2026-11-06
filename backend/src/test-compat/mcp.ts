type ToolHandler = (args: any) => Promise<any> | any;
type Registration = (name: string, schema: unknown, handler: ToolHandler) => void;

let registration: Registration | undefined;

export function setMcpToolRegistration(next: Registration): void {
  registration = next;
}

export class McpServer {
  constructor(_serverInfo: unknown, _options: unknown) {}

  registerTool(name: string, schema: unknown, handler: ToolHandler): void {
    registration?.(name, schema, handler);
  }
}
