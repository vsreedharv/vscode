/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ISCMService, IBaselineResourceProvider, ISCMProvider } from './scm';

export class SCMService implements ISCMService {

	_serviceBrand;

	private activeProviderContextKey: IContextKey<string | undefined>;
	private providers: IBaselineResourceProvider[] = [];
	private _activeProvider: ISCMProvider;

	constructor(
		@IContextKeyService private contextKeyService: IContextKeyService
	) {
		this.activeProviderContextKey = contextKeyService.createKey<string | undefined>('scm.provider', void 0);
	}

	get activeProvider(): ISCMProvider {
		return this._activeProvider;
	}

	set activeProvider(provider: ISCMProvider) {
		this._activeProvider = provider;
		this.activeProviderContextKey.set(provider.id);
	}

	getBaselineResource(resource: URI): TPromise<URI> {
		const promises = this.providers
			.map(p => p.getBaselineResource(resource));

		return TPromise.join(promises).then(originalResources => {
			// TODO@Joao: just take the first
			return originalResources.filter(uri => !!uri)[0];
		});
	}

	registerBaselineResourceProvider(provider: IBaselineResourceProvider): IDisposable {
		this.providers = [provider, ...this.providers];

		return toDisposable(() => {
			const index = this.providers.indexOf(provider);

			if (index < 0) {
				return;
			}

			this.providers.splice(index, 1);
		});
	}
}