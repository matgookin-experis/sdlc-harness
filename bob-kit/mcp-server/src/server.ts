/**
 * server.ts — MCP Server factory for sdlc-harness.
 *
 * The low-level Server is used because it accepts a protocol-level JSON Schema.
 * Bob needs parameters exposed as top-level properties, while the server keeps
 * the full Zod discriminated union for action-specific runtime validation.
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

type JsonSchema = Record<string, unknown>;

/**
 * Bob currently ignores properties that only appear inside `anyOf`. Expose a
 * flat top-level object for tool discovery while retaining the original Zod
 * discriminated union for strict validation when a tool is called.
 */
export function buildInputSchema(schema: ZodTypeAny): JsonSchema {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;

  const variants = Array.isArray(json.anyOf) ? (json.anyOf as JsonSchema[]) : [];
  if (variants.length > 0) {
    const properties: JsonSchema = {};
    const actionValues: unknown[] = [];

    for (const variant of variants) {
      const variantProperties = (variant.properties ?? {}) as JsonSchema;
      for (const [name, property] of Object.entries(variantProperties)) {
        if (name === "action") {
          const value = (property as JsonSchema).const;
          if (value !== undefined && !actionValues.includes(value)) actionValues.push(value);
          continue;
        }
        properties[name] ??= property;
      }
    }

    properties.action = {
      type: "string",
      enum: actionValues,
      description: "Operation to perform. Other required fields depend on this action.",
    };

    return {
      type: "object",
      properties,
      required: ["action"],
      additionalProperties: false,
    };
  }

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
