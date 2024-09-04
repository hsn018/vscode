/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { derived, observableFromEvent, waitForState } from '../../../../base/common/observable.js';
import { ValueWithChangeEventFromObservable } from '../../../../base/common/observableInternal/utils.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IMultiDiffEditorOptions } from '../../../../editor/browser/widget/multiDiffEditor/multiDiffEditorWidgetImpl.js';
import { localize2 } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyValue } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMultiDiffSourceResolver, IMultiDiffSourceResolverService, IResolvedMultiDiffSource, MultiDiffEditorItem } from './multiDiffSourceResolverService.js';
import { ISCMRepository, ISCMResourceGroup, ISCMService } from '../../scm/common/scm.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IActivityService, ProgressBadge } from '../../../services/activity/common/activity.js';

export class ScmMultiDiffSourceResolver implements IMultiDiffSourceResolver {
	private static readonly _scheme = 'scm-multi-diff-source';

	public static getMultiDiffSourceUri(repositoryUri: string, groupId: string): URI {
		return URI.from({
			scheme: ScmMultiDiffSourceResolver._scheme,
			query: JSON.stringify({ repositoryUri, groupId } satisfies UriFields),
		});
	}

	private static parseUri(uri: URI): { repositoryUri: URI; groupId: string } | undefined {
		if (uri.scheme !== ScmMultiDiffSourceResolver._scheme) {
			return undefined;
		}

		let query: UriFields;
		try {
			query = JSON.parse(uri.query) as UriFields;
		} catch (e) {
			return undefined;
		}

		if (typeof query !== 'object' || query === null) {
			return undefined;
		}

		const { repositoryUri, groupId } = query;
		if (typeof repositoryUri !== 'string' || typeof groupId !== 'string') {
			return undefined;
		}

		return { repositoryUri: URI.parse(repositoryUri), groupId };
	}

	constructor(
		@ISCMService private readonly _scmService: ISCMService,
		@IActivityService private readonly _activityService: IActivityService,
	) {
	}

	canHandleUri(uri: URI): boolean {
		return ScmMultiDiffSourceResolver.parseUri(uri) !== undefined;
	}

	async resolveDiffSource(uri: URI): Promise<IResolvedMultiDiffSource> {
		const { repositoryUri, groupId } = ScmMultiDiffSourceResolver.parseUri(uri)!;

		const repository = await waitForState(observableFromEvent(this,
			this._scmService.onDidAddRepository,
			() => [...this._scmService.repositories].find(r => r.provider.rootUri?.toString() === repositoryUri.toString()))
		);
		const group = await waitForState(observableFromEvent(this,
			repository.provider.onDidChangeResourceGroups,
			() => repository.provider.groups.find(g => g.id === groupId)
		));

		const scmActivities = observableFromEvent(
			this._activityService.onDidChangeActivity,
			() => [...this._activityService.getViewContainerActivities('workbench.view.scm')],
		);
		const scmViewHasNoProgressBadge = scmActivities.map(activities => !activities.some(a => a.badge instanceof ProgressBadge));
		await waitForState(scmViewHasNoProgressBadge, v => v);

		return new ScmResolvedMultiDiffSource(group, repository);
	}
}

class ScmResolvedMultiDiffSource implements IResolvedMultiDiffSource {
	private readonly _resources = observableFromEvent<MultiDiffEditorItem[]>(
		this._group.onDidChangeResources,
		() => /** @description resources */ this._group.resources.map(e => new MultiDiffEditorItem(e.multiDiffEditorOriginalUri, e.multiDiffEditorModifiedUri, e.sourceUri))
	);
	readonly resources = new ValueWithChangeEventFromObservable(this._resources);

	public readonly contextKeys: Record<string, ContextKeyValue> = {
		scmResourceGroup: this._group.id,
		scmProvider: this._repository.provider.contextValue,
	};

	constructor(
		private readonly _group: ISCMResourceGroup,
		private readonly _repository: ISCMRepository,
	) { }
}

interface UriFields {
	repositoryUri: string;
	groupId: string;
}

export class ScmMultiDiffSourceResolverContribution extends Disposable {

	static readonly ID = 'workbench.contrib.scmMultiDiffSourceResolver';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IMultiDiffSourceResolverService multiDiffSourceResolverService: IMultiDiffSourceResolverService,
	) {
		super();

		this._register(multiDiffSourceResolverService.registerResolver(instantiationService.createInstance(ScmMultiDiffSourceResolver)));
	}
}

interface OpenScmGroupActionOptions {
	title: string;
	repositoryUri: UriComponents;
	resourceGroupId: string;
}

export class OpenScmGroupAction extends Action2 {
	public static async openMultiFileDiffEditor(editorService: IEditorService, label: string, repositoryRootUri: URI | undefined, resourceGroupId: string, options?: IMultiDiffEditorOptions) {
		if (!repositoryRootUri) {
			return;
		}

		const multiDiffSource = ScmMultiDiffSourceResolver.getMultiDiffSourceUri(repositoryRootUri.toString(), resourceGroupId);
		return await editorService.openEditor({ label, multiDiffSource, options });
	}

	constructor() {
		super({
			id: '_workbench.openScmMultiDiffEditor',
			title: localize2('viewChanges', 'View Changes'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, options: OpenScmGroupActionOptions): Promise<void> {
		const editorService = accessor.get(IEditorService);
		await OpenScmGroupAction.openMultiFileDiffEditor(editorService, options.title, URI.revive(options.repositoryUri), options.resourceGroupId);
	}
}
