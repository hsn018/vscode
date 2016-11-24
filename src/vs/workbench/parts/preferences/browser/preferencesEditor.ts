/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import * as nls from 'vs/nls';
import * as platform from 'vs/base/common/platform';
import URI from 'vs/base/common/uri';
import { hasClass, getDomNodePagePosition } from 'vs/base/browser/dom';
import { parse } from 'vs/base/common/json';
import { Disposable } from 'vs/base/common/lifecycle';
import { IAction } from 'vs/base/common/actions';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import Event, { Emitter } from 'vs/base/common/event';
import { LinkedMap as Map } from 'vs/base/common/map';
import { Registry } from 'vs/platform/platform';
import { EditorOptions, EditorInput, } from 'vs/workbench/common/editor';
import { Range } from 'vs/editor/common/core/range';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { StringEditor } from 'vs/workbench/browser/parts/editor/stringEditor';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFoldingController, ID as FoldingContributionId } from 'vs/editor/contrib/folding/common/folding';
import { IPreferencesService, ISettingsGroup, ISetting, ISettingsEditorModel, IKeybindingsEditorModel, IPreferencesEditorModel } from 'vs/workbench/parts/preferences/common/preferences';
import { DefaultSettings } from 'vs/workbench/parts/preferences/common/preferencesModels';
import { editorContribution } from 'vs/editor/browser/editorBrowserExtensions';
import { ICodeEditor, IEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITextModelResolverService } from 'vs/editor/common/services/resolverService';
import { CopyPreferenceWidget } from 'vs/workbench/parts/preferences/browser/preferencesWidgets';

export class DefaultPreferencesInput extends ResourceEditorInput {

	private _willDispose = new Emitter<void>();
	public willDispose: Event<void> = this._willDispose.event;

	constructor(
		name: string,
		description: string,
		resource: URI,
		@ITextModelResolverService textModelResolverService: ITextModelResolverService
	) {
		super(name, description, resource, textModelResolverService);
	}

	public getResource(): URI {
		return this.resource;
	}

	public dispose() {
		this._willDispose.fire();
		this._willDispose.dispose();
		super.dispose();
	}
}

export class DefaultSettingsInput extends DefaultPreferencesInput {
	private static INSTANCE: DefaultSettingsInput;

	public static getInstance(instantiationService: IInstantiationService, defaultSettings: ISettingsEditorModel): DefaultSettingsInput {
		if (!DefaultSettingsInput.INSTANCE) {
			DefaultSettingsInput.INSTANCE = instantiationService.createInstance(DefaultSettingsInput, nls.localize('defaultName', "Default Settings"), null, defaultSettings.uri);
		}
		return DefaultSettingsInput.INSTANCE;
	}
}

export class DefaultKeybindingsInput extends DefaultPreferencesInput {
	private static INSTANCE: DefaultKeybindingsInput;

	public static getInstance(instantiationService: IInstantiationService, defaultKeybindings: IKeybindingsEditorModel): DefaultKeybindingsInput {
		if (!DefaultKeybindingsInput.INSTANCE) {
			DefaultKeybindingsInput.INSTANCE = instantiationService.createInstance(DefaultKeybindingsInput, nls.localize('defaultKeybindings', "Default Keyboard Shortcuts"), null, defaultKeybindings.uri);
		}

		return DefaultKeybindingsInput.INSTANCE;
	}
}

export class DefaultPreferencesEditor extends StringEditor {

	public static ID = 'workbench.editors.defaultPrefrencesEditor';

	private static VIEW_STATE: Map<URI, editorCommon.IEditorViewState> = new Map<URI, editorCommon.IEditorViewState>();

	private inputDisposeListener;

	public getId(): string {
		return DefaultPreferencesEditor.ID;
	}

	public setInput(input: EditorInput, options: EditorOptions): TPromise<void> {
		this.listenToInput(input);
		return super.setInput(input, options);
	}

	public clearInput(): void {
		this.saveState(<DefaultPreferencesInput>this.input);
		if (this.inputDisposeListener) {
			this.inputDisposeListener.dispose();
		}
		super.clearInput();
	}

	protected restoreViewState(input: EditorInput) {
		const viewState = DefaultPreferencesEditor.VIEW_STATE.get((<DefaultPreferencesInput>input).getResource());
		if (viewState) {
			this.getControl().restoreViewState(viewState);
		} else if (input instanceof DefaultSettingsInput) {
			this.foldAll();
		}
	}

	private saveState(input: DefaultPreferencesInput) {
		const state = this.getControl().saveViewState();
		if (state) {
			const resource = input.getResource();
			if (DefaultPreferencesEditor.VIEW_STATE.has(resource)) {
				DefaultPreferencesEditor.VIEW_STATE.delete(resource);
			}
			DefaultPreferencesEditor.VIEW_STATE.set(resource, state);
		}
	}

	private foldAll() {
		const foldingController = (<editorCommon.ICommonCodeEditor>this.getControl()).getContribution<IFoldingController>(FoldingContributionId);
		foldingController.foldAll();
	}

	private listenToInput(input: EditorInput) {
		if (this.inputDisposeListener) {
			this.inputDisposeListener.dispose();
		}
		if (input instanceof DefaultPreferencesInput) {
			this.inputDisposeListener = (<DefaultPreferencesInput>input).willDispose(() => this.saveState(<DefaultPreferencesInput>input));
		}
	}
}

export interface IPreferencesRenderer {
	render();
	dispose();
}

@editorContribution
export class PreferencesEditorContribution extends Disposable implements editorCommon.IEditorContribution {

	private preferencesRenderer: IPreferencesRenderer;

	constructor(private editor: ICodeEditor,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPreferencesService private preferencesService: IPreferencesService
	) {
		super();
		this._register(editor.onDidChangeModel(() => this.onModelChanged()));
	}

	private onModelChanged(): void {
		const model = this.editor.getModel();
		this.disposePreferencesRenderer();
		if (model) {
			this.preferencesService.resolvePreferencesEditorModel(model.uri)
				.then(editorModel => {
					if (editorModel) {
						this.preferencesRenderer = this.createPreferencesRenderer(editorModel);
						this.preferencesRenderer.render();
					}
				});
		}
	}

	getId(): string {
		return 'editor.contrib.preferences';
	}

	private createPreferencesRenderer(editorModel: IPreferencesEditorModel): IPreferencesRenderer {
		if (editorModel instanceof DefaultSettings) {
			return this.instantiationService.createInstance(DefaultSettingsRenderer, this.editor, editorModel);
		}
		return null;
	}

	private disposePreferencesRenderer() {
		if (this.preferencesRenderer) {
			this.preferencesRenderer.dispose();
			this.preferencesRenderer = null;
		}
	}

	public dispose() {
		this.disposePreferencesRenderer();
		super.dispose();
	}
}

export class DefaultSettingsRenderer extends Disposable implements IPreferencesRenderer {

	private settingsActionsRenderer: SettingsActionsRenderer;
	private copyPreferenceLightBulbRenderer: CopySettingsLightBulbRenderer;

	constructor(protected editor: ICodeEditor, protected settingsEditorModel: DefaultSettings,
		@IPreferencesService protected preferencesService: IPreferencesService,
		@IInstantiationService protected instantiationService: IInstantiationService
	) {
		super();
		this.settingsActionsRenderer = this._register(instantiationService.createInstance(SettingsActionsRenderer, editor));
		this.copyPreferenceLightBulbRenderer = this._register(instantiationService.createInstance(CopySettingsLightBulbRenderer, editor, this.settingsEditorModel.settingsGroups));
	}

	public render() {
		this.settingsActionsRenderer.render(this.settingsEditorModel.settingsGroups);
	}
}

export class CopySettingsLightBulbRenderer extends Disposable {

	private copyPreferenceWidgetForCusorPosition: CopyPreferenceWidget<ISetting>;
	private copyPreferenceWidgetForMouseMove: CopyPreferenceWidget<ISetting>;

	constructor(private editor: ICodeEditor, private settingsGroups: ISettingsGroup[],
		@IPreferencesService private preferencesService: IPreferencesService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IContextMenuService private contextMenuService: IContextMenuService
	) {
		super();
		this.copyPreferenceWidgetForCusorPosition = this._register(this.instantiationService.createInstance(CopyPreferenceWidget, editor));
		this.copyPreferenceWidgetForMouseMove = this._register(this.instantiationService.createInstance(CopyPreferenceWidget, editor));

		this._register(this.copyPreferenceWidgetForCusorPosition.onClick(setting => this.copy(setting, this.copyPreferenceWidgetForCusorPosition)));
		this._register(this.copyPreferenceWidgetForMouseMove.onClick(setting => this.copy(setting, this.copyPreferenceWidgetForMouseMove)));

		this._register(this.editor.onDidChangeCursorPosition((positionChangeEvent => this.onPositionChanged(positionChangeEvent))));
		this._register(this.editor.onMouseMove((mouseMoveEvent => this.onMouseMoved(mouseMoveEvent))));
	}

	private copy(setting: ISetting, copyPreferenceWidget: CopyPreferenceWidget<ISetting>) {
		let jsonSchema: IJSONSchema = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[setting.key];
		let elementPosition = getDomNodePagePosition(copyPreferenceWidget.getDomNode());
		const anchor = { x: elementPosition.left + elementPosition.width, y: elementPosition.top + elementPosition.height + 10 };
		const actions = this.getActions(setting, jsonSchema);
		if (actions) {
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				getActions: () => TPromise.wrap(actions)
			});
			return;
		}
		this.preferencesService.copyConfiguration(setting);
	}

	private getActions(setting: ISetting, jsonSchema: IJSONSchema): IAction[] {
		if (jsonSchema.type === 'boolean') {
			return [<IAction>{
				id: 'truthyValue',
				label: 'true',
				enabled: true,
				run: () => this.preferencesService.copyConfiguration({ key: setting.key, value: true })
			}, <IAction>{
				id: 'falsyValue',
				label: 'false',
				enabled: true,
				run: () => this.preferencesService.copyConfiguration({ key: setting.key, value: false })
			}];
		}
		if (jsonSchema.enum) {
			return jsonSchema.enum.map(value => {
				return <IAction>{
					id: value,
					label: value,
					enabled: true,
					run: () => this.preferencesService.copyConfiguration({ key: setting.key, value })
				};
			});
		}
		return null;
	}

	private onPositionChanged(positionChangeEvent: editorCommon.ICursorPositionChangedEvent) {
		this.copyPreferenceWidgetForMouseMove.hide();
		const setting = this.getSetting(positionChangeEvent.position.lineNumber);
		if (setting) {
			this.showCopyPreferencesWidget(this.copyPreferenceWidgetForCusorPosition, setting);
		} else {
			this.copyPreferenceWidgetForCusorPosition.hide();
		}
	}

	private onMouseMoved(mouseMoveEvent: IEditorMouseEvent) {
		if (mouseMoveEvent.event.target === this.copyPreferenceWidgetForMouseMove.getDomNode() ||
			mouseMoveEvent.event.target === this.copyPreferenceWidgetForCusorPosition.getDomNode()) {
			return;
		}
		const setting = mouseMoveEvent.target.position ? this.getSetting(mouseMoveEvent.target.position.lineNumber) : null;
		if (setting && mouseMoveEvent.target.position.lineNumber !== this.copyPreferenceWidgetForCusorPosition.getLine()) {
			this.showCopyPreferencesWidget(this.copyPreferenceWidgetForMouseMove, setting);
		} else {
			this.copyPreferenceWidgetForMouseMove.hide();
		}
	}

	private showCopyPreferencesWidget(copyPreferencesWidget: CopyPreferenceWidget<ISetting>, setting: ISetting) {
		copyPreferencesWidget.show(setting.valueRange.startLineNumber, setting);
		let jsonSchema: IJSONSchema = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[setting.key];
		if (jsonSchema.type === 'boolean' || jsonSchema.enum) {
			copyPreferencesWidget.getDomNode().title = nls.localize('selectAndCopyTitle', "Select a value and copy in Settings");
		} else {
			copyPreferencesWidget.getDomNode().title = nls.localize('copyTitle', "Copy in Settings");
		}
	}

	private getSetting(lineNumber: number): ISetting {
		for (const group of this.settingsGroups) {
			if (Range.containsPosition(group.range, { lineNumber, column: 1 })) {
				for (const section of group.sections) {
					for (const setting of section.settings) {
						if (lineNumber === setting.valueRange.startLineNumber) {
							return setting;
						}
					}
				}
			}
		}
		return null;
	}
}

export class SettingsActionsRenderer extends Disposable {

	private decorationIds: string[] = [];
	private static HOVER_MESSAGE = platform.isMacintosh ? nls.localize('selectAndCopyHoverMac', "Cmd + click to select and copy in Settings") : nls.localize('selectAndCopyHover', "Ctrl + click to select and copy in Settings");

	constructor(private editor: ICodeEditor,
		@IPreferencesService private settingsService: IPreferencesService,
		@IContextMenuService private contextMenuService: IContextMenuService
	) {
		super();
		this._register(editor.onMouseUp(e => this.onEditorMouseUp(e)));
	}

	public render(settingGroups: ISettingsGroup[]): void {
		const model = this.editor.getModel();
		model.changeDecorations(changeAccessor => {
			this.decorationIds = changeAccessor.deltaDecorations(this.decorationIds, []);
		});
		model.changeDecorations(changeAccessor => {
			this.decorationIds = changeAccessor.deltaDecorations(this.decorationIds, this.createDecorations(settingGroups, model));
		});
	}

	private createDecorations(settingsGroups: ISettingsGroup[], model: editorCommon.IModel): editorCommon.IModelDeltaDecoration[] {
		let result: editorCommon.IModelDeltaDecoration[] = [];
		for (const settingsGroup of settingsGroups) {
			for (const settingsSection of settingsGroup.sections) {
				for (const setting of settingsSection.settings) {
					const decoration = this.createSelectSettingDecoration(setting, model);
					if (decoration) {
						result.push(decoration);
					}
				}
			}
		}
		return result;
	}

	private createSelectSettingDecoration(setting: ISetting, model: editorCommon.IModel): editorCommon.IModelDeltaDecoration {
		const jsonSchema: IJSONSchema = this.getConfigurationsMap()[setting.key];
		if (jsonSchema.enum || jsonSchema.type === 'boolean') {
			return {
				range: setting.valueRange,
				options: {
					inlineClassName: 'selectSettingValue',
					stickiness: editorCommon.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
					hoverMessage: SettingsActionsRenderer.HOVER_MESSAGE
				}
			};
		}
		return null;
	}

	private onEditorMouseUp(e: IEditorMouseEvent): void {
		let range = e.target.range;
		if (!range || !range.isEmpty) {
			return;
		}
		if (!e.event.leftButton) {
			return;
		}

		switch (e.target.type) {
			case editorCommon.MouseTargetType.CONTENT_TEXT:
				if ((e.event.ctrlKey || e.event.metaKey) && hasClass(<HTMLElement>e.target.element, 'selectSettingValue')) {
					this.onClick(e);
				}
				return;
			default:
				return;
		}
	}

	private getConfigurationsMap(): { [qualifiedKey: string]: IJSONSchema } {
		return Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	}

	private onClick(e: IEditorMouseEvent) {
		const model = this.editor.getModel();
		const setting = parse('{' + model.getLineContent(e.target.range.startLineNumber) + '}');
		const key = Object.keys(setting)[0];
		let value = setting[key];
		let jsonSchema: IJSONSchema = this.getConfigurationsMap()[key];
		const actions = this.getActions(key, jsonSchema);
		if (actions) {
			let elementPosition = getDomNodePagePosition(<HTMLElement>e.target.element);
			const anchor = { x: elementPosition.left, y: elementPosition.top + elementPosition.height + 10 };
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				getActions: () => TPromise.wrap(actions)
			});
			return;
		}
		this.settingsService.copyConfiguration({ key, value });
	}

	private getActions(key: string, jsonSchema: IJSONSchema): IAction[] {
		if (jsonSchema.type === 'boolean') {
			return [<IAction>{
				id: 'truthyValue',
				label: 'true',
				enabled: true,
				run: () => this.settingsService.copyConfiguration({ key, value: true })
			}, <IAction>{
				id: 'falsyValue',
				label: 'false',
				enabled: true,
				run: () => this.settingsService.copyConfiguration({ key, value: false })
			}];
		}
		if (jsonSchema.enum) {
			return jsonSchema.enum.map(value => {
				return <IAction>{
					id: value,
					label: value,
					enabled: true,
					run: () => this.settingsService.copyConfiguration({ key, value })
				};
			});
		}
		return null;
	}
}