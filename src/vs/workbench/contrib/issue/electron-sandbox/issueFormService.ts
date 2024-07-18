/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import { BrowserWindow, BrowserWindowConstructorOptions, Display, screen } from 'electron';
import { safeInnerHtml } from 'vs/base/browser/dom';
import { mainWindow } from 'vs/base/browser/window';
import { DisposableStore } from 'vs/base/common/lifecycle';
import 'vs/css!./media/issueReporter';
import BaseHtml from 'vs/workbench/contrib/issue/browser/issueReporterPage';

// import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { ExtensionIdentifier, ExtensionIdentifierSet } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/common/native';
import product from 'vs/platform/product/common/product';
import { IWindowState } from 'vs/platform/window/electron-main/window';
import { BrowserWindow } from 'vs/workbench/browser/window';
import { IssuePassData } from 'vs/workbench/contrib/issue/browser/issueFormService';
import { IIssueMainService, IssueReporterData, IssueReporterWindowConfiguration } from 'vs/workbench/contrib/issue/common/issue';
import { IssueReporter2 } from 'vs/workbench/contrib/issue/electron-sandbox/issueReporterService2';
import { AuxiliaryWindowMode, IAuxiliaryWindowService } from 'vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ITitleService } from 'vs/workbench/services/title/browser/titleService';

interface IBrowserWindowOptions {
	backgroundColor: string | undefined;
	title: string;
	zoomLevel: number;
	alwaysOnTop: boolean;
}

type IStrictWindowState = Required<Pick<IWindowState, 'x' | 'y' | 'width' | 'height'>>;

export class IssueFormService2 implements IIssueMainService {

	private configuration: IssueReporterWindowConfiguration | undefined;

	private extensionIdentifierSet: ExtensionIdentifierSet = new ExtensionIdentifierSet();

	declare readonly _serviceBrand: undefined;

	private static readonly DEFAULT_BACKGROUND_COLOR = '#1E1E1E';

	private issueReporterWindow: Window | null = null;
	private issueReporterParentWindow: BrowserWindow | null = null;

	constructor(
		// private userEnv: IProcessEnvironment,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ITitleService private readonly titleService: ITitleService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
		// @IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
	) {
		// listen for messages from the main window
		mainWindow.addEventListener('message', async (event) => {
			if (event.data && event.data.sendChannel === 'vscode:triggerReporterMenu') {
				// creates menu from contributed
				const menu = this.menuService.createMenu(MenuId.IssueReporter, this.contextKeyService);

				// render menu and dispose
				const actions = menu.getActions({ renderShortTitle: true }).flatMap(entry => entry[1]);
				for (const action of actions) {
					try {
						if (action.item && 'source' in action.item && action.item.source?.id === event.data.extensionId) {
							this.extensionIdentifierSet.add(event.data.extensionId);
							await action.run();
						}
					} catch (error) {
						console.error(error);
					}
				}

				if (!this.extensionIdentifierSet.has(event.data.extensionId)) {
					// send undefined to indicate no action was taken
					const replyChannel = `vscode:triggerReporterMenuResponse`;
					mainWindow.postMessage({ replyChannel }, '*');
				}

				menu.dispose();
			}
		});
	}

	//#region Used by renderer

	// async openReporter(data: IssueReporterData): Promise<void> {
	// 	if (!this.issueReporterWindow) {
	// 		this.issueReporterParentWindow = BrowserWindow.getFocusedWindow();
	// 		if (this.issueReporterParentWindow) {
	// 			const issueReporterDisposables = new DisposableStore();

	// 			const issueReporterWindowConfigUrl = issueReporterDisposables.add(this.protocolMainService.createIPCObjectUrl<IssueReporterWindowConfiguration>());
	// 			const position = this.getWindowPosition(this.issueReporterParentWindow, 700, 800);

	// 			this.issueReporterWindow = this.createBrowserWindow(position, issueReporterWindowConfigUrl, {
	// 				backgroundColor: data.styles.backgroundColor,
	// 				title: localize('issueReporter', "Issue Reporter"),
	// 				zoomLevel: data.zoomLevel,
	// 				alwaysOnTop: false
	// 			}, 'issue-reporter');

	// 			// Store into config object URL
	// 			issueReporterWindowConfigUrl.update({
	// 				appRoot: this.environmentMainService.appRoot,
	// 				windowId: this.issueReporterWindow.id,
	// 				userEnv: this.userEnv,
	// 				data,
	// 				disableExtensions: !!this.environmentMainService.disableExtensions,
	// 				os: {
	// 					type: type(),
	// 					arch: arch(),
	// 					release: release(),
	// 				},
	// 				product,
	// 				nls: {
	// 					// VSCODE_GLOBALS: NLS
	// 					messages: globalThis._VSCODE_NLS_MESSAGES,
	// 					language: globalThis._VSCODE_NLS_LANGUAGE
	// 				}
	// 			});

	// 			this.issueReporterWindow.loadURL(
	// 				FileAccess.asBrowserUri(`vs/workbench/contrib/issue/electron-sandbox/issueReporter${this.environmentMainService.isBuilt ? '' : '-dev'}.html`).toString(true)
	// 			);

	// 			this.issueReporterWindow.on('close', () => {
	// 				this.issueReporterWindow = null;
	// 				issueReporterDisposables.dispose();
	// 			});

	// 			this.issueReporterParentWindow.on('closed', () => {
	// 				if (this.issueReporterWindow) {
	// 					this.issueReporterWindow.close();
	// 					this.issueReporterWindow = null;
	// 					issueReporterDisposables.dispose();
	// 				}
	// 			});
	// 		}
	// 	}

	// 	else if (this.issueReporterWindow) {
	// 		this.focusWindow(this.issueReporterWindow);
	// 	}
	// }
	async openReporter(data: IssueReporterData): Promise<void> {
		if (data.extensionId && this.extensionIdentifierSet.has(data.extensionId)) {
			const replyChannel = `vscode:triggerReporterMenuResponse`;
			mainWindow.postMessage({ data, replyChannel }, '*');
			this.extensionIdentifierSet.delete(new ExtensionIdentifier(data.extensionId));
		}

		if (this.issueReporterWindow) {
			const getModelData = await this.getIssueData();
			if (getModelData) {
				const { issueTitle, issueBody } = getModelData;
				if (issueTitle || issueBody) {
					data.issueTitle = data.issueTitle ?? issueTitle;
					data.issueBody = data.issueBody ?? issueBody;

					// close issue reporter and re-open with new data
					// this.issueReporterWindow.close();
					// this.openAuxIssueReporter(data);
					// return;
				}
			}
			this.issueReporterWindow.focus();
			return;
		}
		this.openAuxIssueReporter(data);
	}

	async openAuxIssueReporter(data: IssueReporterData): Promise<void> {
		const disposables = new DisposableStore();


		// const centerX = display.bounds.x + (display.bounds.width / 2);
		// const centerY = display.bounds.y + (display.bounds.height / 2);
		// const windowSize = window.win.getSize(); // Get the current window size
		// const x = Math.round(centerX - (windowSize[0] / 2));
		// const y = Math.round(centerY - (windowSize[1] / 2));

		// Auxiliary Window
		const auxiliaryWindow = disposables.add(await this.auxiliaryWindowService.open({ mode: AuxiliaryWindowMode.Normal, bounds: { width: 700, height: 800 } }));
		this.issueReporterWindow = auxiliaryWindow.window;

		if (auxiliaryWindow) {
			await auxiliaryWindow.whenStylesHaveLoaded;
			auxiliaryWindow.window.document.title = 'Issue Reporter';
			auxiliaryWindow.window.document.body.classList.add('issue-reporter-body');

			// custom issue reporter wrapper
			const div = document.createElement('div');
			div.classList.add('monaco-workbench');

			// removes preset monaco-workbench
			auxiliaryWindow.container.remove();
			auxiliaryWindow.window.document.body.appendChild(div);
			safeInnerHtml(div, BaseHtml());

			const temp = this.environmentService.disableExtensions;
			const test = !!this.environmentService.disableExtensions;

			// Store into config object URL
			this.configuration = {
				appRoot: this.environmentService.appRoot,
				windowId: 0,
				userEnv: {},
				data,
				disableExtensions: !!this.environmentService.disableExtensions,
				os: {
					type: '',
					arch: '',
					release: '',
				},
				product,
				nls: {
					// VSCODE_GLOBALS: NLS
					messages: globalThis._VSCODE_NLS_MESSAGES,
					language: globalThis._VSCODE_NLS_LANGUAGE
				}
			};

			// create issue reporter and instantiate
			const issueReporter = this.instantiationService.createInstance(IssueReporter2, this.configuration, this.issueReporterWindow);
			issueReporter.render();
		} else {
			console.error('Failed to open auxiliary window');
		}

		// handle closing issue reporter
		this.issueReporterWindow?.addEventListener('beforeunload', () => {
			auxiliaryWindow.window.close();
			this.issueReporterWindow = null;
		});
	}

	//#endregion

	//#region used by issue reporter window

	async getIssueData(): Promise<IssuePassData | undefined> {
		const sendChannel = `vscode:triggerIssueData`;
		mainWindow.postMessage({ sendChannel }, '*');

		const result = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				mainWindow.removeEventListener('message', listener);
				reject(new Error('Timeout exceeded'));
			}, 5000); // Set the timeout value in milliseconds (e.g., 5000 for 5 seconds)

			const listener = (event: MessageEvent) => {
				const replyChannel = `vscode:triggerIssueDataResponse`;
				if (event.data && event.data.replyChannel === replyChannel) {
					clearTimeout(timeout);
					mainWindow.removeEventListener('message', listener);
					resolve(event.data.data);
				}
			};
			mainWindow.addEventListener('message', listener);
		});

		return result as IssuePassData | undefined;
	}

	async $reloadWithExtensionsDisabled(): Promise<void> {
		// if (this.issueReporterParentWindow) {
		// 	try {
		// 		await this.nativeHostService.reload({ disableExtensions: true });
		// 	} catch (error) {
		// 		this.logService.error(error);
		// 	}
		// }
	}

	async $showConfirmCloseDialog(): Promise<void> {
		// if (this.issueReporterWindow) {
		// 	const { response } = await this.dialogService.showMessageBox({
		// 		type: 'warning',
		// 		message: localize('confirmCloseIssueReporter', "Your input will not be saved. Are you sure you want to close this window?"),
		// 		buttons: [
		// 			localize({ key: 'yes', comment: ['&& denotes a mnemonic'] }, "&&Yes"),
		// 			localize('cancel', "Cancel")
		// 		]
		// 	}, this.issueReporterWindow);

		// 	if (response === 0) {
		// 		if (this.issueReporterWindow) {
		// 			// this.issueReporterWindow.destroy();
		// 			this.issueReporterWindow = null;
		// 		}
		// 	}
		// }
	}

	async $showClipboardDialog(): Promise<boolean> {
		// if (this.issueReporterWindow) {
		// 	const { response } = await this.dialogService.showMessageBox({
		// 		type: 'warning',
		// 		message: localize('issueReporterWriteToClipboard', "There is too much data to send to GitHub directly. The data will be copied to the clipboard, please paste it into the GitHub issue page that is opened."),
		// 		buttons: [
		// 			localize({ key: 'ok', comment: ['&& denotes a mnemonic'] }, "&&OK"),
		// 			localize('cancel', "Cancel")
		// 		]
		// 	}, this.issueReporterWindow);

		// 	return response === 0;
		// }

		return false;
	}

	// issueReporterWindowCheck(): ICodeWindow {
	// 	if (!this.issueReporterParentWindow) {
	// 		throw new Error('Issue reporter window not available');
	// 	}
	// 	const window = this.windowsMainService.getWindowById(this.issueReporterParentWindow.id);
	// 	if (!window) {
	// 		throw new Error('Window not found');
	// 	}
	// 	return window;
	// }

	async $sendReporterMenu(extensionId: string, extensionName: string): Promise<IssueReporterData | undefined> {
		const sendChannel = `vscode:triggerReporterMenu`;
		mainWindow.postMessage({ sendChannel, extensionId, extensionName }, '*');

		const result = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				mainWindow.removeEventListener('message', listener);
				reject(new Error('Timeout exceeded'));
			}, 5000); // Set the timeout value in milliseconds (e.g., 5000 for 5 seconds)

			const listener = (event: MessageEvent) => {
				const replyChannel = `vscode:triggerReporterMenuResponse`;
				if (event.data && event.data.replyChannel === replyChannel) {
					clearTimeout(timeout);
					mainWindow.removeEventListener('message', listener);
					resolve(event.data.data);
				}
			};
			mainWindow.addEventListener('message', listener);
		});

		return result as IssueReporterData | undefined;
	}

	async $closeReporter(): Promise<void> {
		this.issueReporterWindow?.close();
	}

	//#endregion

	// private focusWindow(window: BrowserWindow): void {
	// 	if (window.isMinimized()) {
	// 		window.restore();
	// 	}

	// 	window.focus();
	// }

	// private createBrowserWindow<T>(position: IWindowState, ipcObjectUrl: IIPCObjectUrl<T>, options: IBrowserWindowOptions, windowKind: string): BrowserWindow {
	// 	const window = new BrowserWindow({
	// 		fullscreen: false,
	// 		skipTaskbar: false,
	// 		resizable: true,
	// 		width: position.width,
	// 		height: position.height,
	// 		minWidth: 300,
	// 		minHeight: 200,
	// 		x: position.x,
	// 		y: position.y,
	// 		title: options.title,
	// 		backgroundColor: options.backgroundColor || IssueMainService.DEFAULT_BACKGROUND_COLOR,
	// 		webPreferences: {
	// 			preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-sandbox/preload.js').fsPath,
	// 			additionalArguments: [`--vscode-window-config=${ipcObjectUrl.resource.toString()}`],
	// 			v8CacheOptions: this.environmentService.useCodeCache ? 'bypassHeatCheck' : 'none',
	// 			enableWebSQL: false,
	// 			spellcheck: false,
	// 			zoomFactor: zoomLevelToZoomFactor(options.zoomLevel),
	// 			sandbox: true
	// 		},
	// 		alwaysOnTop: options.alwaysOnTop,
	// 		experimentalDarkMode: true
	// 	} as BrowserWindowConstructorOptions & { experimentalDarkMode: boolean });

	// 	window.setMenuBarVisibility(false);

	// 	return window;
	// }

	// private getWindowPosition(parentWindow: BrowserWindow, defaultWidth: number, defaultHeight: number): IStrictWindowState {

	// 	// We want the new window to open on the same display that the parent is in
	// 	let displayToUse: Display | undefined;
	// 	const displays = screen.getAllDisplays();

	// 	// Single Display
	// 	if (displays.length === 1) {
	// 		displayToUse = displays[0];
	// 	}

	// 	// Multi Display
	// 	else {

	// 		// on mac there is 1 menu per window so we need to use the monitor where the cursor currently is
	// 		if (isMacintosh) {
	// 			const cursorPoint = screen.getCursorScreenPoint();
	// 			displayToUse = screen.getDisplayNearestPoint(cursorPoint);
	// 		}

	// 		// if we have a last active window, use that display for the new window
	// 		if (!displayToUse && parentWindow) {
	// 			displayToUse = screen.getDisplayMatching(parentWindow.getBounds());
	// 		}

	// 		// fallback to primary display or first display
	// 		if (!displayToUse) {
	// 			displayToUse = screen.getPrimaryDisplay() || displays[0];
	// 		}
	// 	}

	// 	const displayBounds = displayToUse.bounds;

	// 	const state: IStrictWindowState = {
	// 		width: defaultWidth,
	// 		height: defaultHeight,
	// 		x: displayBounds.x + (displayBounds.width / 2) - (defaultWidth / 2),
	// 		y: displayBounds.y + (displayBounds.height / 2) - (defaultHeight / 2)
	// 	};

	// 	if (displayBounds.width > 0 && displayBounds.height > 0 /* Linux X11 sessions sometimes report wrong display bounds */) {
	// 		if (state.x < displayBounds.x) {
	// 			state.x = displayBounds.x; // prevent window from falling out of the screen to the left
	// 		}

	// 		if (state.y < displayBounds.y) {
	// 			state.y = displayBounds.y; // prevent window from falling out of the screen to the top
	// 		}

	// 		if (state.x > (displayBounds.x + displayBounds.width)) {
	// 			state.x = displayBounds.x; // prevent window from falling out of the screen to the right
	// 		}

	// 		if (state.y > (displayBounds.y + displayBounds.height)) {
	// 			state.y = displayBounds.y; // prevent window from falling out of the screen to the bottom
	// 		}

	// 		if (state.width > displayBounds.width) {
	// 			state.width = displayBounds.width; // prevent window from exceeding display bounds width
	// 		}

	// 		if (state.height > displayBounds.height) {
	// 			state.height = displayBounds.height; // prevent window from exceeding display bounds height
	// 		}
	// 	}

	// 	return state;
	// }
}
