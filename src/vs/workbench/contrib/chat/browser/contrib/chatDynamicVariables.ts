/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../../base/common/arrays.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange, Range } from '../../../../../editor/common/core/range.js';
import { IDecorationOptions } from '../../../../../editor/common/editorCommon.js';
import { Command } from '../../../../../editor/common/languages.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { AnythingQuickAccessProviderRunOptions, IQuickAccessOptions } from '../../../../../platform/quickinput/common/quickAccess.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IChatWidget } from '../chat.js';
import { ChatWidget, IChatWidgetContrib } from '../chatWidget.js';
import { IChatRequestVariableValue, IChatVariablesService, IDynamicVariable } from '../../common/chatVariables.js';

export const dynamicVariableDecorationType = 'chat-dynamic-variable';

function changeIsBeforeVariable(changeRange: IRange, variableRange: IRange): boolean {
	return (
		changeRange.endLineNumber < variableRange.startLineNumber ||
		(changeRange.endLineNumber === variableRange.startLineNumber && changeRange.endColumn <= variableRange.startColumn)
	);
}

function changeIsAfterVariable(changeRange: IRange, variableRange: IRange): boolean {
	return (
		changeRange.startLineNumber > variableRange.endLineNumber ||
		(changeRange.startLineNumber === variableRange.endLineNumber && changeRange.startColumn >= variableRange.endColumn)
	);
}

export class ChatDynamicVariableModel extends Disposable implements IChatWidgetContrib {
	public static readonly ID = 'chatDynamicVariableModel';

	private _variables: IDynamicVariable[] = [];
	get variables(): ReadonlyArray<IDynamicVariable> {
		return [...this._variables];
	}

	get id() {
		return ChatDynamicVariableModel.ID;
	}

	constructor(
		private readonly widget: IChatWidget,
		@ILabelService private readonly labelService: ILabelService,
	) {
		super();
		this._register(widget.inputEditor.onDidChangeModelContent(e => {
			e.changes.forEach(c => {
				// Don't mutate entries in _variables, since they will be returned from the getter
				this._variables = coalesce(this._variables.map(ref => {
					const intersection = Range.intersectRanges(ref.range, c.range);
					if (intersection && !intersection.isEmpty()) {
						// The reference text was changed, it's broken.
						// But if the whole reference range was deleted (eg history navigation) then don't try to change the editor.
						if (!Range.containsRange(c.range, ref.range)) {
							const rangeToDelete = new Range(ref.range.startLineNumber, ref.range.startColumn, ref.range.endLineNumber, ref.range.endColumn - 1);
							this.widget.inputEditor.executeEdits(this.id, [{
								range: rangeToDelete,
								text: '',
							}]);
						}
						return null;
					} else if (Range.compareRangesUsingStarts(ref.range, c.range) > 0) {
						// Determine if the change is before, after, or overlaps with the variable range.
						if (changeIsBeforeVariable(c.range, ref.range)) {

							// Calculate line delta
							const linesInserted = c.text.split('\n').length - 1;
							const linesRemoved = c.range.endLineNumber - c.range.startLineNumber;
							const lineDelta = linesInserted - linesRemoved;

							// Initialize column delta
							let columnDelta = 0;

							// Check if change is on the same line as the variable start
							if (c.range.endLineNumber === ref.range.startLineNumber) {
								// Change is on the same line
								if (c.range.endColumn <= ref.range.startColumn) {
									// Change occurs before the variable start column
									if (linesInserted === 0) {
										// Single-line change
										const charsInserted = c.text.length;
										const charsRemoved = c.rangeLength;
										columnDelta = charsInserted - charsRemoved;
									} else {
										// Multi-line change (newline inserted)
										columnDelta = - (c.range.endColumn - 1);
										// The variable column should be adjusted to account for the reset after newline
									}
								} else {
									// Change occurs after the variable start column
									columnDelta = 0;
								}
							} else if (c.range.endLineNumber < ref.range.startLineNumber) {
								// Change is on lines before the variable line
								columnDelta = 0;
							}

							return {
								...ref,
								range: {
									startLineNumber: ref.range.startLineNumber + lineDelta,
									startColumn: ref.range.startColumn + columnDelta,
									endLineNumber: ref.range.endLineNumber + lineDelta,
									endColumn: ref.range.endColumn + columnDelta
								}
							};
						} else if (changeIsAfterVariable(c.range, ref.range)) {
							// Change is after the variable no adjustment needed.
							return ref;
						} else {
							// Change overlaps with the variable the variable is broken.
							return null;
						}
					}
					return ref;
				}));
			});

			this.updateDecorations();
		}));
	}

	getInputState(): any {
		return this.variables;
	}

	setInputState(s: any): void {
		if (!Array.isArray(s)) {
			s = [];
		}

		this._variables = s;
		this.updateDecorations();
	}

	addReference(ref: IDynamicVariable): void {
		this._variables.push(ref);
		this.updateDecorations();
	}

	private updateDecorations(): void {
		this.widget.inputEditor.setDecorationsByType('chat', dynamicVariableDecorationType, this._variables.map((r): IDecorationOptions => ({
			range: r.range,
			hoverMessage: this.getHoverForReference(r)
		})));
	}

	private getHoverForReference(ref: IDynamicVariable): IMarkdownString | undefined {
		const value = ref.data;
		if (URI.isUri(value)) {
			return new MarkdownString(this.labelService.getUriLabel(value, { relative: true }));
		} else {
			return undefined;
		}
	}
}

ChatWidget.CONTRIBS.push(ChatDynamicVariableModel);

interface SelectAndInsertFileActionContext {
	widget: IChatWidget;
	range: IRange;
}

function isSelectAndInsertFileActionContext(context: any): context is SelectAndInsertFileActionContext {
	return 'widget' in context && 'range' in context;
}

export class SelectAndInsertFileAction extends Action2 {
	static readonly Name = 'files';
	static readonly Item = {
		label: localize('allFiles', 'All Files'),
		description: localize('allFilesDescription', 'Search for relevant files in the workspace and provide context from them'),
	};
	static readonly ID = 'workbench.action.chat.selectAndInsertFile';

	constructor() {
		super({
			id: SelectAndInsertFileAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const textModelService = accessor.get(ITextModelService);
		const logService = accessor.get(ILogService);
		const quickInputService = accessor.get(IQuickInputService);
		const chatVariablesService = accessor.get(IChatVariablesService);

		const context = args[0];
		if (!isSelectAndInsertFileActionContext(context)) {
			return;
		}

		const doCleanup = () => {
			// Failed, remove the dangling `file`
			context.widget.inputEditor.executeEdits('chatInsertFile', [{ range: context.range, text: `` }]);
		};

		let options: IQuickAccessOptions | undefined;
		// If we have a `files` variable, add an option to select all files in the picker.
		// This of course assumes that the `files` variable has the behavior that it searches
		// through files in the workspace.
		if (chatVariablesService.hasVariable(SelectAndInsertFileAction.Name)) {
			const providerOptions: AnythingQuickAccessProviderRunOptions = {
				additionPicks: [SelectAndInsertFileAction.Item, { type: 'separator' }]
			};
			options = { providerOptions };
		}
		// TODO: have dedicated UX for this instead of using the quick access picker
		const picks = await quickInputService.quickAccess.pick('', options);
		if (!picks?.length) {
			logService.trace('SelectAndInsertFileAction: no file selected');
			doCleanup();
			return;
		}

		const editor = context.widget.inputEditor;
		const range = context.range;

		// Handle the special case of selecting all files
		if (picks[0] === SelectAndInsertFileAction.Item) {
			const text = `#${SelectAndInsertFileAction.Name}`;
			const success = editor.executeEdits('chatInsertFile', [{ range, text: text + ' ' }]);
			if (!success) {
				logService.trace(`SelectAndInsertFileAction: failed to insert "${text}"`);
				doCleanup();
			}
			return;
		}

		// Handle the case of selecting a specific file
		const resource = (picks[0] as unknown as { resource: unknown }).resource as URI;
		if (!textModelService.canHandleResource(resource)) {
			logService.trace('SelectAndInsertFileAction: non-text resource selected');
			doCleanup();
			return;
		}

		const fileName = basename(resource);
		const text = `#file:${fileName}`;
		const success = editor.executeEdits('chatInsertFile', [{ range, text: text + ' ' }]);
		if (!success) {
			logService.trace(`SelectAndInsertFileAction: failed to insert "${text}"`);
			doCleanup();
			return;
		}

		context.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
			id: 'vscode.file',
			isFile: true,
			prefix: 'file',
			range: { startLineNumber: range.startLineNumber, startColumn: range.startColumn, endLineNumber: range.endLineNumber, endColumn: range.startColumn + text.length },
			data: resource
		});
	}
}
registerAction2(SelectAndInsertFileAction);

export interface IAddDynamicVariableContext {
	id: string;
	widget: IChatWidget;
	range: IRange;
	variableData: IChatRequestVariableValue;
	command?: Command;
}

function isAddDynamicVariableContext(context: any): context is IAddDynamicVariableContext {
	return 'widget' in context &&
		'range' in context &&
		'variableData' in context;
}

export class AddDynamicVariableAction extends Action2 {
	static readonly ID = 'workbench.action.chat.addDynamicVariable';

	constructor() {
		super({
			id: AddDynamicVariableAction.ID,
			title: '' // not displayed
		});
	}

	async run(accessor: ServicesAccessor, ...args: any[]) {
		const context = args[0];
		if (!isAddDynamicVariableContext(context)) {
			return;
		}

		let range = context.range;
		const variableData = context.variableData;

		const doCleanup = () => {
			// Failed, remove the dangling variable prefix
			context.widget.inputEditor.executeEdits('chatInsertDynamicVariableWithArguments', [{ range: context.range, text: `` }]);
		};

		// If this completion item has no command, return it directly
		if (context.command) {
			// Invoke the command on this completion item along with its args and return the result
			const commandService = accessor.get(ICommandService);
			const selection: string | undefined = await commandService.executeCommand(context.command.id, ...(context.command.arguments ?? []));
			if (!selection) {
				doCleanup();
				return;
			}

			// Compute new range and variableData
			const insertText = ':' + selection;
			const insertRange = new Range(range.startLineNumber, range.endColumn, range.endLineNumber, range.endColumn + insertText.length);
			range = new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn + insertText.length);
			const editor = context.widget.inputEditor;
			const success = editor.executeEdits('chatInsertDynamicVariableWithArguments', [{ range: insertRange, text: insertText + ' ' }]);
			if (!success) {
				doCleanup();
				return;
			}
		}

		context.widget.getContrib<ChatDynamicVariableModel>(ChatDynamicVariableModel.ID)?.addReference({
			id: context.id,
			range: range,
			isFile: true,
			prefix: 'file',
			data: variableData
		});
	}
}
registerAction2(AddDynamicVariableAction);
