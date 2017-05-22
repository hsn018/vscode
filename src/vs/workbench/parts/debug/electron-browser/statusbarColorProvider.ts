/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IThemeService } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IPartService, Parts } from 'vs/workbench/services/part/common/partService';
import { IDebugService, State } from 'vs/workbench/parts/debug/common/debug';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_BACKGROUND, STATUS_BAR_NO_FOLDER_FOREGROUND, STATUS_BAR_FOREGROUND, Themable } from 'vs/workbench/common/theme';

// colors for theming

export const STATUS_BAR_DEBUGGING_BACKGROUND = registerColor('statusBar.debuggingBackground', {
	dark: '#CC6633',
	light: '#CC6633',
	hc: '#CC6633'
}, localize('statusBarDebuggingBackground', "Status bar background color when a program is being debugged. The status bar is shown in the bottom of the window"));

export const STATUS_BAR_DEBUGGING_FOREGROUND = registerColor('statusBar.debuggingForeground', {
	dark: STATUS_BAR_FOREGROUND,
	light: STATUS_BAR_FOREGROUND,
	hc: STATUS_BAR_FOREGROUND
}, localize('statusBarDebuggingForeground', "Status bar foreground color when a program is being debugged. The status bar is shown in the bottom of the window"));

export class StatusBarColorProvider extends Themable implements IWorkbenchContribution {
	private static ID = 'debug.statusbarColorProvider';

	constructor(
		@IThemeService themeService: IThemeService,
		@IDebugService private debugService: IDebugService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@IPartService private partService: IPartService
	) {
		super(themeService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this.toUnbind.push(this.debugService.onDidChangeState(state => this.onDidChangeState(state)));
	}

	private onDidChangeState(state: State): void {
		this.updateStyles();
	}

	protected updateStyles(): void {
		super.updateStyles();

		if (this.partService.isVisible(Parts.STATUSBAR_PART)) {
			const container = this.partService.getContainer(Parts.STATUSBAR_PART);
			container.style.backgroundColor = this.getColor(this.getBackgroundColorKey());
			container.style.color = this.getColor(this.getForegroundColorKey());
		}
	}

	private getBackgroundColorKey(): string {
		// Not debugging
		if (this.debugService.state === State.Inactive || this.isRunningWithoutDebug()) {
			if (this.contextService.hasWorkspace()) {
				return STATUS_BAR_BACKGROUND;
			}

			return STATUS_BAR_NO_FOLDER_BACKGROUND;
		}

		// Debugging
		return STATUS_BAR_DEBUGGING_BACKGROUND;
	}

	private getForegroundColorKey(): string {
		// Not debugging
		if (this.debugService.state === State.Inactive || this.isRunningWithoutDebug()) {
			if (this.contextService.hasWorkspace()) {
				return STATUS_BAR_FOREGROUND;
			}

			return STATUS_BAR_NO_FOLDER_FOREGROUND;
		}

		// Debugging
		return STATUS_BAR_DEBUGGING_FOREGROUND;
	}

	private isRunningWithoutDebug(): boolean {
		const process = this.debugService.getViewModel().focusedProcess;

		return process && process.configuration && process.configuration.noDebug;
	}

	public getId(): string {
		return StatusBarColorProvider.ID;
	}
}