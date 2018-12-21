/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMenubarService, IMenubarData } from 'vs/platform/menubar/common/menubar';
import { Menubar } from 'vs/platform/menubar/electron-main/menubar';
import { ILogService } from 'vs/platform/log/common/log';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import * as Registry from 'winreg';
import { isWindows } from 'vs/base/common/platform';

export class MenubarService implements IMenubarService {
	_serviceBrand: any;

	private _menubar: Menubar;

	constructor(
		@IInstantiationService private instantiationService: IInstantiationService,
		@ILogService private logService: ILogService
	) {
		// Install Menu
		this._menubar = this.instantiationService.createInstance(Menubar);
	}

	updateMenubar(windowId: number, menus: IMenubarData): Promise<void> {
		this.logService.trace('menubarService#updateMenubar', windowId);

		if (this._menubar) {
			this._menubar.updateMenu(menus, windowId);
		}

		return Promise.resolve(void 0);
	}

	accessKeysAlwaysOn(): Promise<boolean> {
		if (!isWindows) {
			return Promise.resolve(false);
		}

		return new Promise<boolean>((resolve, reject) => {
			const reg = new Registry({
				hive: Registry.HKCU,
				key: '\\Control Panel\\Accessibility\\Keyboard Preference'
			});

			reg.get('On', (err, res) => {
				if (err) {
					reject(err);
				} else {
					resolve(res.value === '1');
				}
			});

			setTimeout(() => {
				reject('Timed out accessing the registry key.');
			}, 1000);
		});
	}
}