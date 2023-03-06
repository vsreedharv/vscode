/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import { conditionalRegistration, requireMinVersion, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';
import API from '../utils/api';

class JsxLinkedEditingSupport implements vscode.LinkedEditingRangeProvider {

	public static readonly minVersion = API.v510;

	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	async provideLinkedEditingRanges(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.LinkedEditingRanges | undefined> {
		const filepath = this.client.toOpenTsFilePath(document);
		if (!filepath) {
			return undefined;
		}

		const args = typeConverters.Position.toFileLocationRequestArgs(filepath, position);
		const response = await this.client.execute('jsxLinkedEdit', args, token);
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}

		const wordPattern = response.body.wordPattern ? new RegExp(response.body.wordPattern) : undefined;
		return new vscode.LinkedEditingRanges(response.body.ranges.map(range => typeConverters.Range.fromTextSpan(range)), wordPattern);
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient
) {
	return conditionalRegistration([
		requireMinVersion(client, JsxLinkedEditingSupport.minVersion),
		requireSomeCapability(client, ClientCapability.Syntax),
	], () => {
		return vscode.languages.registerLinkedEditingRangeProvider(selector.semantic,
			new JsxLinkedEditingSupport(client));
	});
}
