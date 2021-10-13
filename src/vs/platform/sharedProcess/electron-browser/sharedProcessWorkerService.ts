/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from 'electron';
import { FileAccess } from 'vs/base/common/network';
import { ILogService } from 'vs/platform/log/common/log';
import { ISharedProcessWorkerConfiguration, ISharedProcessWorkerService } from 'vs/platform/sharedProcess/common/sharedProcessWorkerService';
import { SHARED_PROCESS_WORKER_REQUEST, SHARED_PROCESS_WORKER_RESPONSE, ISharedProcessWorkerMessage } from 'vs/platform/sharedProcess/electron-browser/sharedProcessWorker';

export class SharedProcessWorkerService implements ISharedProcessWorkerService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
	}

	async createWorker(configuration: ISharedProcessWorkerConfiguration): Promise<void> {
		this.logService.trace(`SharedProcess: createWorker (window: ${configuration.reply.windowId}, moduleId: ${configuration.process.moduleId})`);

		// Create a `MessageChannel` with 2 ports:
		// `windowPort`: send back to the requesting window
		// `workerPort`: send into a new worker to use
		const { port1: windowPort, port2: workerPort } = new MessageChannel();

		// Window Port
		{
			// We cannot just send the `MessagePort` through our protocol back
			// because the port can only be sent via `postMessage`. So we need
			// to send it through the main process to back to the window.
			ipcRenderer.postMessage('vscode:relaySharedProcessWorkerMessageChannel', configuration, [windowPort]);
		}

		// Worker Port
		{
			// TODO@bpasero what is the lifecycle of workers?
			// Should probably dispose on port close?
			const worker = new Worker('../../../base/worker/workerMain.js', {
				name: `Shared Process Worker (window: ${configuration.reply.windowId}, moduleId: ${configuration.process.moduleId})`
			});

			worker.onerror = event => {
				this.logService.error(`SharedProcess: worker error (window: ${configuration.reply.windowId}, moduleId: ${configuration.process.moduleId})`, event);
			};

			worker.onmessage = event => {
				switch (event.data) {
					case SHARED_PROCESS_WORKER_REQUEST:
						const message: ISharedProcessWorkerMessage = {
							id: SHARED_PROCESS_WORKER_RESPONSE,
							configuration,
							environment: {
								bootstrapPath: FileAccess.asFileUri('bootstrap-fork', require).fsPath
							}
						};
						worker.postMessage(message, [workerPort]);
						break;
					default:
						this.logService.error(`SharedProcess: unexpected worker message (window: ${configuration.reply.windowId}, moduleId: ${configuration.process.moduleId})`, event);
				}
			};

			// First message triggers the load of the worker
			worker.postMessage('vs/platform/sharedProcess/electron-browser/sharedProcessWorkerMain');
		}
	}
}
