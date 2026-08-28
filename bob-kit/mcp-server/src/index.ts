/**
 * index.ts — MCP server entry point for sdlc-harness.
 *
 * Startup sequence:
 *  1. Load configuration from the env file (throws with a clear message if
 *     required variables are missing).
 *  2. Construct the GitLab client with the loaded config.
 *  3. Build the shared ToolContext.
 *  4. Create a low-level Server, register ListTools + CallTool handlers so that
 *     discriminated-union Zod schemas are published as proper JSON object Schemas.
 *  5. Connect via StdioServerTransport and stay running.
 *
 * Why the low-level Server rather than McpServer?
 *  McpServer.registerTool() calls normalizeObjectSchema() internally, which only
 *  handles z.object() schemas (those with a `.shape` property). Discriminated
 *  unions expose no `.shape`, so the SDK falls back to publishing an empty
 *  inputSchema for every tool. Using the low-level Server lets us build the
 *  inputSchema ourselves.
 *
 * Why not emit anyOf from zodToJsonSchema?
 *  The MCP protocol requires inputSchema.type === "object" strictly (validated
 *  by the SDK's Zod schema on the ListTools result). We flatten the discriminated
 *  union into a single object schema: all per-variant properties merged with
 *  everything optional, plus an `action` enum listing all valid discriminator
 *  values. This satisfies the protocol and gives hosts enough information to
 *  drive tool calls correctly.
 *
 * Stderr is kept quiet unless SDLC_DEBUG=true so Bob's stdio transport
 * is not polluted with log noise.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { loadConfig, debugLog } from "./env.js";
import { GitLabClient } from "./gitlab-client.js";
import { TOOLS } from "./tools.js";
import type { ToolContext } from "./types.js";

// ---------------------------------------------------------------------------
// Schema flattening — discriminated union → MCP-compatible object schema
// ---------------------------------------------------------------------------

/**
 * The MCP protocol requires inputSchema to be a JSON Schema object with
 * type === "object". zodToJsonSchema produces anyOf for discriminated unions,
 * which the SDK's Zod validator rejects on the ListTools response.
 *
 * This function flattens a Zod discriminated union into a single object schema:
 *  - All properties from all variants are merged (each made optional).
 *  - The discriminator field ("action") becomes an enum of all literal values.
 *  - "action" is the only required field.
 *
 * The result is valid per the MCP spec and gives the host sufficient information
 * to construct valid tool calls.
 */
function buildInputSchema(schema: ZodTypeAny): Record<string, unknown> {
  // Handle discriminated unions
  const def = (schema as { _def?: { typeName?: string; options?: ZodTypeAny[]; discriminator?: string } })._def;
  if (def?.typeName === "ZodDiscriminatedUnion" && Array.isArray(def.options)) {
    const discriminator = def.discriminator ?? "action";
    const mergedProperties: Record<string, unknown> = {};
    const actionLiterals: string[] = [];

    for (const variant of def.options as ZodTypeAny[]) {
      const variantDef = (variant as { _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> } })._def;
      if (!variantDef?.shape) continue;
      const shape = typeof variantDef.shape === "function" ? variantDef.shape() : variantDef.shape;
      for (const [key, fieldSchema] of Object.entries(shape as Record<string, ZodTypeAny>)) {
        if (key === discriminator) {
          // Collect all literal values for the discriminator enum
          const litDef = (fieldSchema as { _def?: { value?: string } })._def;
          if (litDef?.value !== undefined) {
            actionLiterals.push(litDef.value as string);
          }
        } else if (!(key in mergedProperties)) {
          // Add field as optional (any variant may or may not supply it)
          const fieldJson = zodToJsonSchema(fieldSchema, { $refStrategy: "none" }) as Record<string, unknown>;
          const { $schema: _omit, ...fieldJsonClean } = fieldJson;
          mergedProperties[key] = fieldJsonClean;
        }
      }
    }

    // Build merged discriminator field
    mergedProperties[discriminator] = actionLiterals.length > 0
      ? { type: "string", enum: actionLiterals, description: `Tool action. One of: ${actionLiterals.join(", ")}` }
      : { type: "string" };

    return {
      type: "object",
      properties: mergedProperties,
      required: [discriminator],
    };
  }

  // Fallback: use zodToJsonSchema directly (handles plain z.object())
  const js = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  const { $schema: _omit, ...clean } = js;
  return clean;
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1. Load + validate configuration
  const config = loadConfig();
  debugLog(config, "Configuration loaded successfully.");

  // 2. Construct GitLab client
  const gitlab = new GitLabClient(
    config.gitlabHost,
    config.gitlabToken,
    config.gitlabProject
  );
  debugLog(config, `GitLab client ready for project: ${config.gitlabProject}`);

  // 3. Build shared context
  const context: ToolContext = { gitlab, config };

  // 4. Pre-build MCP-compatible input schemas for all tools
  const toolInputSchemas = new Map(
    TOOLS.map((tool) => [tool.name, buildInputSchema(tool.argsSchema)])
  );

  // 5. Create low-level MCP server and register tool handlers
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

  debugLog(config, `${TOOLS.length} tool(s) registered. Connecting transport...`);

  // 6. Connect stdio transport and keep the process alive
  const transport = new StdioServerTransport();
  await server.connect(transport);

  debugLog(config, "MCP server connected and listening on stdio.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sdlc-harness] Fatal startup error: ${message}\n`);
  process.exit(1);
});
