/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lastOrDefault } from 'vs/base/common/arrays';
import { deepClone } from 'vs/base/common/objects';
import { ISCMHistoryItem, ISCMHistoryItemGraphNode2, ISCMHistoryItemViewModel } from 'vs/workbench/contrib/scm/common/history';
import { ISCMRepository } from 'vs/workbench/contrib/scm/common/scm';

const SWIMLANE_HEIGHT = 22;
const SWIMLANE_WIDTH = 11;
const CIRCLE_RADIUS = 4;

const graphColors = ['#007ACC', '#BC3FBC', '#BF8803', '#CC6633', '#F14C4C', '#16825D'];

function createPath(stroke: string): SVGPathElement {
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', stroke);
	path.setAttribute('stroke-width', '1px');
	path.setAttribute('stroke-linecap', 'round');

	return path;
}

function drawCircle(index: number, radius: number, stroke: string, fill: string): SVGCircleElement {
	const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	circle.setAttribute('cx', `${SWIMLANE_WIDTH * (index + 1)}`);
	circle.setAttribute('cy', `${SWIMLANE_WIDTH}`);
	circle.setAttribute('r', `${radius}`);
	circle.setAttribute('fill', fill);
	circle.setAttribute('stroke', stroke);

	return circle;
}

function drawVerticalLine(x1: number, y1: number, y2: number, color: string): SVGPathElement {
	const path = createPath(color);
	path.setAttribute('d', `M ${x1} ${y1} V ${y2}`);

	return path;
}

function findLastIndex(nodes: ISCMHistoryItemGraphNode2[], id: string): number {
	for (let i = nodes.length - 1; i >= 0; i--) {
		if (nodes[i].id === id) {
			return i;
		}
	}

	return -1;
}

export function renderSCMHistoryItemGraph(historyItemViewModel: ISCMHistoryItemViewModel): SVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('graph');

	const historyItem = historyItemViewModel.historyItem;
	const inputSwimlanes = historyItemViewModel.inputSwimlanes;
	const outputSwimlanes = historyItemViewModel.outputSwimlanes;

	const inputIndex = inputSwimlanes.findIndex(node => node.id === historyItem.id);
	const outputIndex = historyItem.parentIds.length === 0 ? -1 : outputSwimlanes.findIndex(node => node.id === historyItem.parentIds[0]);

	const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;
	const circleColorIndex = inputIndex !== -1 ? inputSwimlanes[inputIndex].color : outputSwimlanes[circleIndex].color;

	for (let index = 0; index < inputSwimlanes.length; index++) {
		const node = inputSwimlanes[index];
		const color = graphColors[inputSwimlanes[index].color];

		// Not the current commit
		if (node.id !== historyItem.id) {
			if (index < outputSwimlanes.length && node.id === outputSwimlanes[index].id) {
				// Draw |
				const path = drawVerticalLine(SWIMLANE_WIDTH * (index + 1), 0, SWIMLANE_HEIGHT, color);
				svg.append(path);
			} else {
				// Draw /
				const d: string[] = [];
				const path = createPath(color);

				d.push(`M ${SWIMLANE_WIDTH * (index + 1)} 0`);
				d.push(`A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * index} ${SWIMLANE_HEIGHT / 2}`);

				// Draw -
				d.push(`H ${SWIMLANE_WIDTH * (findLastIndex(outputSwimlanes, node.id) + 1)}`);

				// Draw |
				d.push(`V ${SWIMLANE_HEIGHT}`);

				path.setAttribute('d', d.join(' '));
				svg.append(path);
			}

			continue;
		}

		// Base commit
		if (index !== circleIndex) {
			const d: string[] = [];
			const path = createPath(color);

			// Draw /
			d.push(`M ${SWIMLANE_WIDTH * (index + 1)} 0`);
			d.push(`A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * (index)} ${SWIMLANE_WIDTH}`);

			// Draw -
			d.push(`H ${SWIMLANE_WIDTH * (circleIndex + 1)}`);

			path.setAttribute('d', d.join(' '));
			svg.append(path);
		}
	}

	// Add remaining parent(s)
	for (let i = 1; i < historyItem.parentIds.length; i++) {
		const parentOutputIndex = outputSwimlanes.findIndex(node => node.id === historyItem.parentIds[i]);
		if (parentOutputIndex === -1) {
			continue;
		}

		// Draw -\
		const d: string[] = [];
		const path = createPath(graphColors[outputSwimlanes[parentOutputIndex].color]);

		// Draw \
		d.push(`M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`);
		d.push(`A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * (parentOutputIndex + 1)} ${SWIMLANE_HEIGHT}`);

		// Draw -
		d.push(`M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`);
		d.push(`H ${SWIMLANE_WIDTH * (circleIndex + 1)} `);

		path.setAttribute('d', d.join(' '));
		svg.append(path);
	}

	// Draw | to circle
	if (inputIndex !== -1) {
		const path = drawVerticalLine(SWIMLANE_WIDTH * (circleIndex + 1), 0, SWIMLANE_HEIGHT / 2, graphColors[circleColorIndex]);
		svg.append(path);
	}

	// Draw | from circle
	if (outputIndex !== -1) {
		const path = drawVerticalLine(SWIMLANE_WIDTH * (circleIndex + 1), SWIMLANE_HEIGHT / 2, SWIMLANE_HEIGHT, graphColors[circleColorIndex]);
		svg.append(path);
	}

	// Draw *
	if (historyItem.parentIds.length === 1) {
		// Node
		// TODO@lszomoru - remove hardcoded color
		const circle = drawCircle(circleIndex, CIRCLE_RADIUS, '#f8f8f8', graphColors[circleColorIndex]);
		svg.append(circle);
	} else {
		// Multi-parent node
		// TODO@lszomoru - remove hardcoded color
		const circleOuter = drawCircle(circleIndex, CIRCLE_RADIUS + 1, '#f8f8f8', graphColors[circleColorIndex]);
		svg.append(circleOuter);

		// TODO@lszomoru - remove hardcoded color
		const circleInner = drawCircle(circleIndex, CIRCLE_RADIUS - 1, '#f8f8f8', graphColors[circleColorIndex]);
		svg.append(circleInner);
	}

	// Set dimensions
	svg.style.height = `${SWIMLANE_HEIGHT}px`;
	svg.style.width = `${SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length) + 1)}px`;

	return svg;
}

export interface ISCMRepositoryGraphController {
	readonly historyItems: ISCMHistoryItemViewModel[];

	appendHistoryItems(historyItems: ISCMHistoryItem[]): void;
	clearHistoryItems(): void;
}

export class SCMRepositoryGraphController implements ISCMRepositoryGraphController {
	private readonly _historyItems: ISCMHistoryItemViewModel[] = [];
	get historyItems(): ISCMHistoryItemViewModel[] { return this._historyItems; }

	private _colorIndex: number = -1;

	constructor(private readonly _repository: ISCMRepository) { }

	appendHistoryItems(historyItems: ISCMHistoryItem[]): void {
		for (let index = 0; index < historyItems.length; index++) {
			const historyItem = historyItems[index];

			const outputSwimlanesFromPreviousItem = lastOrDefault(this.historyItems)?.outputSwimlanes ?? [];
			const inputSwimlanes = outputSwimlanesFromPreviousItem.map(i => deepClone(i));
			const outputSwimlanes: ISCMHistoryItemGraphNode2[] = [];

			if (historyItem.parentIds.length > 0) {
				let firstParentAdded = false;

				// Add first parent to the output
				for (const node of inputSwimlanes) {
					if (node.id === historyItem.id) {
						if (!firstParentAdded) {
							outputSwimlanes.push({
								...deepClone(node),
								id: historyItem.parentIds[0]
							});
							firstParentAdded = true;
						}

						continue;
					}

					outputSwimlanes.push(deepClone(node));
				}

				// Add unprocessed parent(s) to the output
				for (let i = firstParentAdded ? 1 : 0; i < historyItem.parentIds.length; i++) {
					outputSwimlanes.push({
						id: historyItem.parentIds[i],
						color: this.getGraphColorIndex()
					});
				}
			}

			this._historyItems.push({
				historyItem,
				inputSwimlanes,
				outputSwimlanes,
				repository: this._repository,
				type: 'historyItem2'
			});
		}
	}

	clearHistoryItems(): void {
		this._colorIndex = -1;
		this._historyItems.length = 0;
	}

	private getGraphColorIndex(): number {
		this._colorIndex = this._colorIndex < graphColors.length - 1 ? this._colorIndex + 1 : 1;
		return this._colorIndex;
	}
}
