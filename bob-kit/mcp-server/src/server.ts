/**
 * server.ts — MCP Server factory for sdlc-harness.
 *
 * The low-level Server is used because it accepts a protocol-level JSON Schema.
 * This preserves every discriminated-union variant and its required fields while
 * also supplying the top-level object type required by MCP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOLS } from "./tools.js";
import type { ToolContext } from "./types.js";

// ---------------------------------------------------------------------------
// Schema conversion — Zod discriminated union → MCP-compatible JSON Schema
// ---------------------------------------------------------------------------

/**
 * Convert a Zod schema while retaining union-specific required fields.
 * MCP requires a top-level object type, so it is added alongside the generated
 * anyOf variants.
 */
function buildInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return { type: "object", ...json };
}

// ---------------------------------------------------------------------------
// Server factory — testable, transport-independent
// ---------------------------------------------------------------------------

/**
 * Build and return a fully-wired MCP Server.
 * The caller is responsible for connecting a transport.
 * Extracted here so smoke tests can create the server without spawning a subprocess.
 */
export function createServer(context: ToolContext): Server {
  // Pre-build MCP-compatible input schemas for all tools
  const toolInputSchemas = new Map(
    TOOLS.map((tool) => [tool.name, buildInputSchema(tool.argsSchema)])
  );

  const server = new Server(
    { name: "sdlc-harness", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // ListTools — return all registered tools with their MCP-compatible schemas
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toolInputSchemas.get(tool.name)!,
    })),
  }));

  // CallTool — parse args with the full Zod discriminated union, execute
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    const parseResult = tool.argsSchema.safeParse(args ?? {});
    if (!parseResult.success) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for tool ${name}: ${parseResult.error.message}`
      );
    }

    const result = await tool.execute(parseResult.data, context);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  return server;
}
