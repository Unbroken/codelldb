/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'child_process' {
	interface SpawnOptions {
		/**
		 * Override the CPU scheduling priority applied by the extension host's
		 * child-process patch. Accepted values: `'default'`, `'utility'`, `'background'`.
		 */
		__priority?: string;
	}

	interface ForkOptions {
		/**
		 * Override the CPU scheduling priority applied by the extension host's
		 * child-process patch. Accepted values: `'default'`, `'utility'`, `'background'`.
		 */
		__priority?: string;
	}
}
