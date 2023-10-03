/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatAgentContext {

		// messages so far
		history: ChatMessage[]; // Should be same type as request

		// TODO: access to embeddings
		// embeddings: {};

		// TODO: access to "InputSourceId"
		// DebugConsoleOutput
		// Terminal
		// CorrespondingTestFile
		// CorrespondingImplementationFile
		// ExtensionApi
		// VSCode
		// Workspace
	}

	export interface SlashResponse {
		message: MarkdownString | InteractiveProgressFileTree;
		// edits?: TextEdit[] | WorkspaceEdit;
	}

	export interface SlashResult {
		// Should be able to compute these async, because they typically will involve a separate LLM call.
		// That can be a separate call (provideFollowups) or ChatAgentResult contains a promise to it (so ChatAgent returns a promise to a promise).
		// Or, we can just be ok with the UI showing that the response is still continuing when the actual response is done but the followups are being computed.
		provideFollowups?(token: CancellationToken): ProviderResult<InteractiveSessionFollowup[]>;
	}

	export interface SlashCommandMetadata {
		description: string;
	}

	export interface SlashCommand {
		readonly name: string;
		readonly metadata: SlashCommandMetadata;
		invoke: ChatAgentHandler;
	}

	// All agent and slashCommand details must be fully dynamic because they can be loaded from a remote server (github copilot extensibility).
	// But could be declared in package.json a well.
	interface ChatAgent {
		slashCommands: SlashCommand[];
		onDidPerformAction: Event<{ action: InteractiveSessionUserAction }>;
		dispose(): void;
	}

	export interface ChatAgentMetadata {
		description: string;
		fullName?: string;
		icon?: Uri;
	}

	// Could include "slashCommand: SlashCommand | undefined" here instead of the invoke method.
	export type ChatAgentHandler = (request: InteractiveRequest, context: ChatAgentContext, progress: Progress<InteractiveProgress>, token: CancellationToken) => ProviderResult<InteractiveResponseForProgress>;

	export namespace chat {
		// Invoking slash commands vs the agent with no slash command?
		// Could be a separate handler or a slash command with a '' id
		export function createChatAgent(id: string, description: string, fullName?: string, icon?: Uri, handler?: ChatAgentHandler): ChatAgent;
	}
}
