// MCP tool registration. Thin: validate the shape (zod), call a service, format the result.
// The user comes from the OAuth token (ctx.userId); no tool ever accepts a user_id.
import type { McpServer } from "@modelcontextprotocol/server";
import { registerFoodTools } from "./foods";
import { registerLogTools } from "./logs";
import { registerSettingsTools } from "./settings";
import type { ToolContext } from "./shared";
import { registerWorkoutTools } from "./workouts";

export type { ToolContext } from "./shared";

export function registerTools(server: McpServer, ctx: ToolContext) {
	registerFoodTools(server, ctx);
	registerLogTools(server, ctx);
	registerWorkoutTools(server, ctx);
	registerSettingsTools(server, ctx);
}
