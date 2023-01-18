/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, Details, MessageChannelMain, app } from 'electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { StringDecoder } from 'string_decoder';
import { timeout } from 'vs/base/common/async';
import { FileAccess } from 'vs/base/common/network';
import { UtilityProcess as ElectronUtilityProcess, UtilityProcessProposedApi, canUseUtilityProcess } from 'vs/base/parts/sandbox/electron-main/electronTypes';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import Severity from 'vs/base/common/severity';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

export interface IUtilityProcessConfiguration {

	// --- message port response related

	readonly responseWindowId: number;
	readonly responseChannel: string;
	readonly responseNonce: string;

	// --- utility process options

	/**
	 * A way to group utility processes of same type together.
	 */
	readonly type: string;

	/**
	 * Environment key-value pairs. Default is `process.env`.
	 */
	readonly env?: { [key: string]: string | undefined };

	/**
	 * List of string arguments that will be available as `process.argv`
	 * in the child process.
	 */
	readonly args?: string[];

	/**
	 * List of string arguments passed to the executable.
	 */
	readonly execArgv?: string[];

	/**
	 * Allow the utility process to load unsigned libraries.
	 */
	readonly allowLoadingUnsignedLibraries?: boolean;

	/**
	 * Used in log messages to correlate the process
	 * with other components.
	 */
	readonly correlationId?: string;
}

interface IUtilityProcessExitBaseEvent {

	/**
	 * The process id of the process that exited.
	 */
	readonly pid: number;

	/**
	 * The exit code of the process.
	 */
	readonly code: number;
}

export interface IUtilityProcessExitEvent extends IUtilityProcessExitBaseEvent {

	/**
	 * The signal that caused the process to exit is unknown
	 * for utility processes.
	 */
	readonly signal: 'unknown';
}

export interface IUtilityProcessCrashEvent extends IUtilityProcessExitBaseEvent {

	/**
	 * The reason of the utility process crash.
	 */
	readonly reason: 'clean-exit' | 'abnormal-exit' | 'killed' | 'crashed' | 'oom' | 'launch-failed' | 'integrity-failure';
}

export class UtilityProcess extends Disposable {

	private static ID_COUNTER = 0;

	private readonly id = String(++UtilityProcess.ID_COUNTER);

	private readonly _onStdout = this._register(new Emitter<string>());
	readonly onStdout = this._onStdout.event;

	private readonly _onStderr = this._register(new Emitter<string>());
	readonly onStderr = this._onStderr.event;

	private readonly _onMessage = this._register(new Emitter<unknown>());
	readonly onMessage = this._onMessage.event;

	private readonly _onExit = this._register(new Emitter<IUtilityProcessExitEvent>());
	readonly onExit = this._onExit.event;

	private readonly _onCrash = this._register(new Emitter<IUtilityProcessCrashEvent>());
	readonly onCrash = this._onCrash.event;

	private process: UtilityProcessProposedApi.UtilityProcess | undefined = undefined;
	private processPid: number | undefined = undefined;
	private configuration: IUtilityProcessConfiguration | undefined = undefined;

	private didExit: boolean = false;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();
	}

	private log(msg: string, severity: Severity): void {
		let logMsg: string;
		if (this.configuration?.correlationId) {
			logMsg = `[UtilityProcess id: ${this.configuration?.correlationId}, type: ${this.configuration?.type}, pid: ${this.processPid ?? '<none>'}]: ${msg}`;
		} else {
			logMsg = `[UtilityProcess type: ${this.configuration?.type}, pid: ${this.processPid ?? '<none>'}]: ${msg}`;
		}

		switch (severity) {
			case Severity.Error:
				this.logService.error(logMsg);
				break;
			case Severity.Warning:
				this.logService.warn(logMsg);
				break;
			case Severity.Info:
				this.logService.info(logMsg);
				break;
		}
	}

	private validateCanStart(configuration: IUtilityProcessConfiguration): BrowserWindow | undefined {
		if (!canUseUtilityProcess) {
			throw new Error('Cannot use UtilityProcess API from Electron!');
		}

		if (this.process) {
			this.log('Cannot start utility process because it is already running...', Severity.Error);
			return undefined;
		}

		const responseWindow = this.windowsMainService.getWindowById(configuration.responseWindowId)?.win;
		if (!responseWindow || responseWindow.isDestroyed() || responseWindow.webContents.isDestroyed()) {
			this.log('Refusing to start utility process because requesting window cannot be found or is destroyed...', Severity.Error);
			return undefined;
		}

		return responseWindow;
	}

	start(configuration: IUtilityProcessConfiguration): void {
		const responseWindow = this.validateCanStart(configuration);
		if (!responseWindow) {
			return;
		}

		this.configuration = configuration;

		const serviceName = `${this.configuration.type}-${this.id}`;
		const modulePath = FileAccess.asFileUri('bootstrap-fork.js').fsPath;
		const args = [...this.configuration.args ?? [], `--type=${this.configuration.type}`];
		const execArgv = this.configuration.execArgv;
		const allowLoadingUnsignedLibraries = this.configuration.allowLoadingUnsignedLibraries;
		const stdio = 'pipe';

		let env: { [key: string]: any } | undefined = this.configuration.env;
		if (env) {
			env = { ...env }; // make a copy since we may be going to mutate it

			for (const key of Object.keys(env)) {
				env[key] = String(env[key]); // make sure all values are strings, otherwise the process will not start
			}
		}

		this.log('creating new...', Severity.Info);

		// Fork utility process
		this.process = ElectronUtilityProcess.fork(modulePath, args, {
			serviceName,
			env,
			execArgv,
			allowLoadingUnsignedLibraries,
			stdio
		});

		// Register to events
		this.registerListeners(this.process, this.configuration, serviceName);

		// Exchange message ports
		this.exchangeMessagePorts(this.process, this.configuration, responseWindow);
	}

	private registerListeners(process: UtilityProcessProposedApi.UtilityProcess, configuration: IUtilityProcessConfiguration, serviceName: string): void {

		// Stdout
		if (process.stdout) {
			const stdoutDecoder = new StringDecoder('utf-8');
			this._register(Event.fromNodeEventEmitter<string | Buffer>(process.stdout, 'data')(chunk => this._onStdout.fire(typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk))));
		}

		// Stderr
		if (process.stderr) {
			const stderrDecoder = new StringDecoder('utf-8');
			this._register(Event.fromNodeEventEmitter<string | Buffer>(process.stderr, 'data')(chunk => this._onStderr.fire(typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk))));
		}

		//Messages
		this._register(Event.fromNodeEventEmitter(process, 'message')(msg => this._onMessage.fire(msg)));

		// Spawn
		this._register(Event.fromNodeEventEmitter<void>(process, 'spawn')(() => {
			this.processPid = process.pid;

			this.log('successfully created', Severity.Info);
		}));

		// Exit
		this._register(Event.fromNodeEventEmitter<number>(process, 'exit')(code => {
			this.log(`received exit event with code ${code}`, Severity.Info);

			this.didExit = true;

			this._onExit.fire({ pid: this.processPid!, code, signal: 'unknown' });
		}));

		// Child process gone
		this._register(Event.fromNodeEventEmitter<{ details: Details }>(app, 'child-process-gone', (event, details) => ({ event, details }))(({ details }) => {
			if (details.type === 'Utility' && details.name === serviceName) {
				this.log(`crashed with code ${details.exitCode} and reason '${details.reason}'`, Severity.Error);

				// Telemetry
				type UtilityProcessCrashClassification = {
					type: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The type of utility process to understand the origin of the crash better.' };
					reason: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The reason of the utility process crash to understand the nature of the crash better.' };
					code: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The exit code of the utility process to understand the nature of the crash better' };
					owner: 'bpasero';
					comment: 'Provides insight into reasons the utility process crashed.';
				};
				type UtilityProcessCrashEvent = {
					type: string;
					reason: string;
					code: number;
				};
				this.telemetryService.publicLog2<UtilityProcessCrashEvent, UtilityProcessCrashClassification>('utilityprocesscrash', { type: configuration.type, reason: details.reason, code: details.exitCode });

				// Event
				this._onCrash.fire({ pid: this.processPid!, code: details.exitCode, reason: details.reason });
			}
		}));
	}

	private exchangeMessagePorts(process: UtilityProcessProposedApi.UtilityProcess, configuration: IUtilityProcessConfiguration, responseWindow: BrowserWindow) {
		const { port1: windowPort, port2: utilityProcessPort } = new MessageChannelMain();

		process.postMessage('null', [utilityProcessPort]);
		responseWindow.webContents.postMessage(configuration.responseChannel, configuration.responseNonce, [windowPort]);
	}

	enableInspectPort(): boolean {
		if (typeof this.processPid !== 'number') {
			return false;
		}

		this.log('enabling inspect port', Severity.Info);

		interface ProcessExt {
			_debugProcess?(pid: number): unknown;
		}

		// use (undocumented) _debugProcess feature of node if available
		const processExt = <ProcessExt>process;
		if (typeof processExt._debugProcess === 'function') {
			processExt._debugProcess(this.processPid);

			return true;
		}

		// not supported...
		return false;
	}

	kill(): void {
		if (!this.process) {
			this.log('no running process to kill', Severity.Warning);
			return;
		}

		this.log('attempting to kill the process...', Severity.Info);
		const killed = this.process.kill();
		if (killed) {
			this.log('successfully killed the process', Severity.Info);
		} else {
			this.log('unable to kill the process', Severity.Warning);
		}
	}

	async waitForExit(maxWaitTimeMs: number): Promise<void> {
		if (!this.process) {
			this.log('no running process to wait for exit', Severity.Warning);
			return;
		}

		if (this.didExit) {
			return;
		}

		this.log('waiting to exit...', Severity.Info);
		await Promise.race([Event.toPromise(this.onExit), timeout(maxWaitTimeMs)]);

		if (!this.didExit) {
			this.log('did not exit within ${maxWaitTimeMs}ms, will kill it now...', Severity.Info);
			this.kill();
		}
	}
}
