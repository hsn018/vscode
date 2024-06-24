/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageServer, LanguageServerProject } from '@volar/language-server';
import { createLanguageServiceEnvironment, createUriConverter } from '@volar/language-server/browser';
import { LanguagePlugin, LanguageService } from '@volar/language-service';
import * as ts from 'typescript';
import { URI, Utils } from 'vscode-uri';
import { HTMLDocumentRegions } from './embeddedSupport';
import { JQUERY_PATH } from './javascriptLibs';
import { createTypeScriptLanguageService } from './languageService';

export const compilerOptions: ts.CompilerOptions = {
	allowNonTsExtensions: true,
	allowJs: true,
	lib: ['lib.es2020.full.d.ts'],
	target: 99 satisfies ts.ScriptTarget.Latest,
	moduleResolution: 1 satisfies ts.ModuleResolutionKind.Classic,
	experimentalDecorators: false,
};

export function createHtmlProject(languagePlugins: LanguagePlugin<URI>[]): LanguageServerProject {
	let server: LanguageServer;
	let tsLocalized: any;
	let projectVersion = '';
	let currentDirectory = '';
	let languageServicePromise: ReturnType<typeof createTypeScriptLanguageService> | undefined;

	const { asFileName, asUri } = createUriConverter();
	const currentRootFiles: string[] = [];

	return {
		setup(_server) {
			server = _server;
			if (server.initializeParams.locale) {
				try {
					tsLocalized = require(`typescript/lib/${server.initializeParams.locale}/diagnosticMessages.generated.json`);
				} catch { }
			}
		},
		async getLanguageService(uri) {
			if (!languageServicePromise) {
				languageServicePromise = (async () => {
					const project = await createTypeScriptLanguageService(
						ts,
						tsLocalized,
						compilerOptions,
						server,
						createLanguageServiceEnvironment(server, [...server.workspaceFolders.keys()]),
						languagePlugins,
						{ asUri, asFileName },
						() => currentDirectory,
						() => projectVersion,
						() => currentRootFiles
					);
					return project;
				})();
			}
			const { languageService } = (await languageServicePromise);
			updateRootFiles(uri, languageService);
			return languageService;
		},
		async getExistingLanguageServices() {
			if (languageServicePromise) {
				return [(await languageServicePromise).languageService];
			}
			return [];
		},
		reload() {
			languageServicePromise?.then(ls => ls.dispose());
			languageServicePromise = undefined;
		},
	};

	function updateRootFiles(uri: URI, languageService: LanguageService) {
		const document = server.documents.get(server.getSyncedDocumentKey(uri) ?? uri.toString());
		if (!document) {
			return;
		}
		const newProjectVersion = document.uri.toString() + '::' + document.version;
		if (newProjectVersion === projectVersion) {
			return;
		}
		projectVersion = newProjectVersion;
		currentRootFiles.length = 0;
		currentRootFiles.push(JQUERY_PATH);
		currentRootFiles.push(asFileName(uri));

		const sourceScript = languageService.context.language.scripts.get(uri);
		if (sourceScript?.generated && 'documentRegions' in sourceScript.generated.root) {
			const regions = sourceScript.generated.root.documentRegions as HTMLDocumentRegions;
			if (regions) {
				for (const script of regions.getImportedScripts()) {
					if (script.startsWith('http://') || script.startsWith('https://') || script.startsWith('//')) {
						continue;
					}
					else if (script.startsWith('file://')) {
						const scriptUri = URI.parse(script);
						currentRootFiles.push(asFileName(scriptUri));
					}
					else {
						const scriptUri = Utils.resolvePath(Utils.dirname(uri), script);
						currentRootFiles.push(asFileName(scriptUri));
					}
				}
			}
		}
	}
}
