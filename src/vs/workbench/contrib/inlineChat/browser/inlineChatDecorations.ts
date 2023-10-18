/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { ThemeIcon } from 'vs/base/common/themables';
import { ICodeEditor, IEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { GlyphMarginLane, IModelDecorationsChangeAccessor, ITextModel, TrackedRangeStickiness } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { localize } from 'vs/nls';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { Selection } from 'vs/editor/common/core/selection';
import { InlineChatController } from 'vs/workbench/contrib/inlineChat/browser/inlineChatController';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { GutterActionsRegistry } from 'vs/workbench/contrib/codeEditor/browser/editorLineNumberMenu';
import { Action } from 'vs/base/common/actions';
import { CTX_INLINE_CHAT_VISIBLE, IInlineChatService } from 'vs/workbench/contrib/inlineChat/common/inlineChat';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ResourceMap } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { Iterable } from 'vs/base/common/iterator';

const gutterInlineChatIcon = registerIcon('inline-chat', Codicon.sparkle, localize('startInlineChatIcon', 'Icon which spawns the inline chat from the gutter'));

export class InlineChatDecorationsContribution extends Disposable implements IEditorContribution {

	private localToDispose = new DisposableStore();

	private gutterDecorationsMap = new ResourceMap<{ id: string; lineNumber: number } | undefined>();
	private inlineChatLineNumber: number | undefined;

	public static readonly gutterSettingID = 'inlineChat.showGutterIcon';
	private static readonly gutterIconClassName = 'codicon-inline-chat';

	private static readonly GUTTER_DECORATION = ModelDecorationOptions.register({
		description: 'inline-chat-decoration',
		glyphMarginClassName: ThemeIcon.asClassName(gutterInlineChatIcon),
		glyphMargin: { position: GlyphMarginLane.Left },
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
	});

	constructor(
		private readonly editor: ICodeEditor,
		@IInlineChatService private readonly inlineChatService: IInlineChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration((e: IConfigurationChangeEvent) => {
			if (!e.affectsConfiguration(InlineChatDecorationsContribution.gutterSettingID)) {
				return;
			}
			this.onEnablementOrModelChanged();
		}));
		this._register(this.inlineChatService.onDidChangeProviders(() => this.onEnablementOrModelChanged()));
		this._register(this.editor.onDidChangeModel(() => this.onEnablementOrModelChanged()));
	}

	private onEnablementOrModelChanged(): void {
		this.localToDispose.clear(); // cancels the scheduler, removes editor listeners / removes decoration
		const model = this.editor.getModel();
		if (!model || !this.isSettingEnabled() || !this.hasProvider()) {
			return;
		}
		const decorationUpdateScheduler = new RunOnceScheduler(() => this.onSelectionOrContentChanged(model), 200);
		this.localToDispose.add(decorationUpdateScheduler);
		this.localToDispose.add(this.editor.onDidChangeCursorSelection(() => decorationUpdateScheduler.schedule()));
		this.localToDispose.add(this.editor.onDidChangeModelContent(() => decorationUpdateScheduler.schedule()));
		this.localToDispose.add(this.editor.onMouseDown(async (e: IEditorMouseEvent) => {
			if (!e.target.element?.classList.contains(InlineChatDecorationsContribution.gutterIconClassName) || !this.editor.hasModel()) {
				return;
			}
			const startLineNumber = this.editor.getSelection().startLineNumber;
			const inlineChatPositionUnchanged = startLineNumber === this.inlineChatLineNumber;
			const inlineChatVisible = this.contextKeyService.getContextKeyValue<boolean>(CTX_INLINE_CHAT_VISIBLE.key);
			if (inlineChatPositionUnchanged && inlineChatVisible) {
				return;
			}
			this.inlineChatLineNumber = startLineNumber;
			InlineChatController.get(this.editor)?.run();
		}));
		this.localToDispose.add({ dispose: () => { this.clearState(); } });
		decorationUpdateScheduler.schedule();
	}

	private onSelectionOrContentChanged(model: ITextModel): void {
		const uri = model.uri;
		const selection = this.editor.getSelection();
		if (!selection) {
			return;
		}
		const selectionIsEmpty = selection.isEmpty();
		const decorationData = this.gutterDecorationsMap.get(uri);
		const lastDecorationLine = decorationData?.lineNumber;
		const lastDecorationID = decorationData?.id;
		if (selectionIsEmpty && selection.startLineNumber === lastDecorationLine) {
			return;
		}
		const isEnabled = selectionIsEmpty && /^\s*$/g.test(model.getLineContent(selection.startLineNumber));
		if (isEnabled && lastDecorationID === undefined) {
			this.addDecoration(uri, selection.startLineNumber);
		} else if (!isEnabled && lastDecorationID !== undefined) {
			this.removePreviousGutterDecoration(uri);
		} else if (isEnabled && selection.startLineNumber !== lastDecorationLine) {
			this.removePreviousGutterDecoration(uri);
			this.addDecoration(uri, selection.startLineNumber);
		}
	}

	private isSettingEnabled(): boolean {
		return this.configurationService.getValue<boolean>(InlineChatDecorationsContribution.gutterSettingID);
	}

	private hasProvider(): boolean {
		return !Iterable.isEmpty(this.inlineChatService.getAllProvider());
	}

	private addDecoration(uri: URI, lineNumber: number) {
		this.editor.changeDecorations((accessor: IModelDecorationsChangeAccessor) => {
			const id = accessor.addDecoration(new Selection(lineNumber, 0, lineNumber, 0), InlineChatDecorationsContribution.GUTTER_DECORATION);
			this.gutterDecorationsMap.set(uri, { lineNumber, id });
		});
	}

	private removePreviousGutterDecoration(uri: URI) {
		this.editor.changeDecorations((accessor: IModelDecorationsChangeAccessor) => {
			const id = this.gutterDecorationsMap.get(uri)?.id;
			if (id) {
				accessor.removeDecoration(id);
				this.gutterDecorationsMap.set(uri, undefined);
			}
		});
	}

	private clearState() {
		this.inlineChatLineNumber = undefined;
		[...this.gutterDecorationsMap.keys()].forEach((uri: URI) => {
			this.removePreviousGutterDecoration(uri);
		});
		this.gutterDecorationsMap.clear();
	}

	override dispose() {
		super.dispose();
		this.inlineChatLineNumber = undefined;
		this.localToDispose.dispose();
	}
}

GutterActionsRegistry.registerGutterActionsGenerator(({ lineNumber, editor, accessor }, result) => {
	const configurationService = accessor.get(IConfigurationService);
	result.push(new Action(
		'inlineChat.toggleShowGutterIcon',
		localize('toggleShowGutterIcon', "Toggle Inline Chat Icon"),
		undefined,
		true,
		() => { configurationService.updateValue(InlineChatDecorationsContribution.gutterSettingID, !configurationService.getValue<boolean>(InlineChatDecorationsContribution.gutterSettingID)); }
	));
});
