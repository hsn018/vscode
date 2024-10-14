/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation';
import { ISearchModel } from './searchTreeCommon';

export const ISearchViewModelWorkbenchService = createDecorator<ISearchViewModelWorkbenchService>('searchViewModelWorkbenchService');

export interface ISearchViewModelWorkbenchService {
	readonly _serviceBrand: undefined;

	searchModel: ISearchModel;
}
