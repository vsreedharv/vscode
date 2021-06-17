/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TerminalIcon, TitleEventSource } from 'vs/platform/terminal/common/terminal';
import { IEditorInputSerializer } from 'vs/workbench/common/editor';
import { ITerminalEditorService, ITerminalInstance, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalEditorInput } from 'vs/workbench/contrib/terminal/browser/terminalEditorInput';

export class TerminalInputSerializer implements IEditorInputSerializer {
	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalEditorService private readonly _terminalEditorService: ITerminalEditorService
	) { }

	public canSerialize(editorInput: TerminalEditorInput): boolean {
		return true;
	}

	public serialize(editorInput: TerminalEditorInput): string {
		console.log('serialize', editorInput.terminalInstance?.persistentProcessId);
		const term = JSON.stringify(this._toJson(editorInput.terminalInstance));
		this._terminalEditorService.detachInstance(editorInput.terminalInstance!);
		return term;
	}

	public deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): TerminalEditorInput | undefined {
		const terminalInstance = JSON.parse(serializedEditorInput);
		const terminal = this._terminalService.createInstance({ attachPersistentProcess: terminalInstance });
		console.log('deserializing editor', terminalInstance);
		const input = new TerminalEditorInput(terminal);
		terminal.onExit(() => input.dispose());
		return input;
	}

	private _toJson(instance?: ITerminalInstance): SerializedTerminalEditorInput | undefined {
		// TODO update these names
		if (!instance || !instance.persistentProcessId) {
			return undefined;
		}
		return {
			id: instance.persistentProcessId,
			pid: instance.processId || 0,
			title: instance.title,
			titleSource: instance.titleSource,
			cwd: '',
			icon: instance.icon,
			color: instance.color
		};
	}
}

interface SerializedTerminalEditorInput {
	readonly id: number;
	readonly pid: number;
	readonly title: string;
	readonly titleSource: TitleEventSource;
	readonly cwd: string;
	readonly icon?: TerminalIcon;
	readonly color?: string
}
