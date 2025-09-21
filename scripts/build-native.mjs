#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, statSync, createWriteStream, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const extDir = resolve(__dirname, '..');
const buildDir = resolve(extDir, 'build');

function githubRequestHeaders(extra = {}) {
	const headers = { 'User-Agent': 'codelldb-builder', ...extra };
	const token = process.env.CODELLDB_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}
	return headers;
}

function run(cmd, args, opts = {}) {
	console.log('[codelldb] Running:', cmd, args.map(a => a.includes(' ') ? `"${a}"` : a).join(' '));
	return new Promise((resolvePromise, reject) => {
		// On Windows, if cmd is a .bat file, we need to run it through cmd.exe
		let actualCmd = cmd;
		let actualArgs = args;
		if (process.platform === 'win32' && cmd.endsWith('.bat')) {
			actualCmd = 'cmd.exe';
			actualArgs = ['/c', cmd, ...args];
		}
		const p = spawn(actualCmd, actualArgs, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
		p.stdout.on('data', d => process.stdout.write(`[codelldb] ${d}`));
		p.stderr.on('data', d => process.stderr.write(`[codelldb] ${d}`));
		p.on('error', reject);
		p.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited with ${code}`)));
	});
}

function has(cmd) {
	return new Promise(resolve => {
		const p = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd]);
		p.on('close', code => resolve(code === 0));
		p.on('error', () => resolve(false));
	});
}

async function fetchJson(url) {
	if (typeof fetch !== 'function') {
		throw new Error('global fetch is not available in this Node runtime');
	}
	const res = await fetch(url, { headers: githubRequestHeaders({ 'Accept': 'application/vnd.github+json' }) });
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url}`);
	}
	return await res.json();
}

async function downloadFile(url, destPath) {
	if (typeof fetch !== 'function') {
		throw new Error('global fetch is not available in this Node runtime');
	}
	const res = await fetch(url, { headers: githubRequestHeaders() });
	if (!res.ok || !res.body) {
		throw new Error(`HTTP ${res.status} for ${url}`);
	}
	// Convert WHATWG ReadableStream to Node.js Readable for pipeline support
	const nodeReadable = typeof res.body.getReader === 'function' ? Readable.fromWeb(res.body) : res.body;
	await pipeline(nodeReadable, createWriteStream(destPath));
}

function findFirstDir(dir) {
	const children = readdirSync(dir).map(name => join(dir, name));
	for (const child of children) {
		try {
			if (statSync(child).isDirectory()) {
				return child;
			}
		} catch { }
	}
	return dir;
}

async function downloadLatestLLDBPackage() {
	try {
		const plat = process.platform;
		// Normalize arch from VSCODE_ARCH if provided, else from process.arch
		const arch = (() => {
			const a = (process.env.VSCODE_ARCH || process.arch).toLowerCase();
			if (a === 'x64' || a === 'amd64') return 'x64';
			if (a === 'arm64' || a === 'aarch64') return 'arm64';
			if (a === 'armhf' || a === 'arm') return 'arm';
			return process.arch; // fallback
		})();
		// Query latest release assets from the CodeLLDB-maintained LLVM builds
		const release = await fetchJson('https://api.github.com/repos/vadimcn/llvm-project/releases/latest');
		const assets = Array.isArray(release?.assets) ? release.assets : [];
		// Log available assets to help diagnose selection logic
		const names = assets.map(a => a?.name).filter(Boolean);
		console.log('[codelldb] LLVM latest assets:', names.length ? `\n - ${names.join('\n - ')}` : 'none');
		// Map node platform/arch to release triple
		const toTriple = () => {
			if (plat === 'darwin') {
				return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
			}
			if (plat === 'linux') {
				if (arch === 'arm64') { return 'aarch64-linux-gnu'; }
				if (arch.startsWith('arm')) { return 'arm-linux-gnueabihf'; }
				return 'x86_64-linux-gnu';
			}
			if (plat === 'win32') {
				return 'x86_64-windows-msvc';
			}
			return undefined;
		};
		const triple = toTriple();
		if (!triple) {
			console.warn(`[codelldb] Unsupported platform for LLDB auto-download: platform='${plat}' arch='${arch}'`);
			return undefined;
		}
		const expectedName = `lldb--${triple}.zip`;
		const asset = assets.find(a => a?.name === expectedName);
		if (!asset || !asset.browser_download_url) {
			console.warn(`[codelldb] Could not find asset '${expectedName}' in latest release`);
			return undefined;
		}
		console.log(`[codelldb] Downloading LLDB asset: ${asset.name}`);
		const dlDir = join(buildDir, 'downloads');
		mkdirSync(dlDir, { recursive: true });
		const archivePath = join(dlDir, asset.name);
		await downloadFile(asset.browser_download_url, archivePath);
		// CMake project can consume the zip directly; return its path.
		return archivePath;
	} catch (err) {
		console.warn(`[codelldb] Failed to download LLDB package: ${err?.message || err}`);
		return undefined;
	}
}

function resolveToolchainFile() {
	const plat = process.platform;
	// Normalize arch, prefer VSCODE_ARCH if provided
	const normArch = (() => {
		const a = (process.env.VSCODE_ARCH || process.arch || '').toLowerCase();
		if (a === 'x64' || a === 'amd64') { return 'x64'; }
		if (a === 'arm64' || a === 'aarch64') { return 'arm64'; }
		if (a === 'armhf' || a === 'arm') { return 'arm'; }
		return process.arch;
	})();
	const cmakeDir = join(extDir, 'cmake');
	/** @type {string[]} */
	const candidates = [];
	if (plat === 'darwin') {
		candidates.push(normArch === 'arm64' ? 'toolchain-aarch64-apple-darwin.cmake' : 'toolchain-x86_64-apple-darwin.cmake');
	} else if (plat === 'linux') {
		if (normArch === 'arm64') {
			candidates.push('toolchain-aarch64-linux-gnu.cmake');
		} else if (normArch === 'arm') {
			candidates.push('toolchain-arm-linux-gnueabihf.cmake');
		} else {
			candidates.push('toolchain-x86_64-linux-gnu.cmake');
		}
	} else if (plat === 'win32') {
		// Prefer MSVC by default
		candidates.push('toolchain-x86_64-windows-msvc.cmake', 'toolchain-x86_64-windows-gnu.cmake');
	}
	for (const file of candidates) {
		const full = join(cmakeDir, file);
		if (existsSync(full)) {
			return full;
		}
	}
	return undefined;
}

async function tryCMakeBuild() {
	// Clean build dir for non-watch targets to avoid stale artifacts
	const cmakeTarget = process.env.CODELLDB_BUILD_TARGET;
	if (cmakeTarget !== 'dev_debugging') {
		rmSync(buildDir, { recursive: true, force: true });
	}

	mkdirSync(buildDir, { recursive: true });

	const cmakeArgs = ['-S', extDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'];

	// Set extension version suffix for fork builds; overridable via env
	const versionSuffix = process.env.CODELLDB_VERSION_SUFFIX || '-unbroken-code';
	if (versionSuffix) {
		cmakeArgs.push(`-DVERSION_SUFFIX=${versionSuffix}`);
	}

	// Derive VSCE platform identifier (PLATFORM_ID) for packaging
	const archRaw = (process.env.VSCODE_ARCH || process.arch || '').toLowerCase();
	const normArch = archRaw === 'x64' || archRaw === 'amd64' ? 'x64'
		: (archRaw === 'arm64' || archRaw === 'aarch64') ? 'arm64'
			: (archRaw === 'arm' || archRaw === 'armhf') ? 'armhf'
				: archRaw;
	let platformId;
	if (process.platform === 'darwin') {
		platformId = normArch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
	} else if (process.platform === 'linux') {
		if (normArch === 'arm64') {
			platformId = 'linux-arm64';
		} else if (normArch === 'arm' || normArch === 'armhf') {
			platformId = 'linux-armhf';
		} else {
			platformId = 'linux-x64';
		}
	} else if (process.platform === 'win32') {
		platformId = normArch === 'arm64' ? 'win32-arm64' : 'win32-x64';
	}
	if (platformId) {
		cmakeArgs.push(`-DPLATFORM_ID=${platformId}`);
	}

	// On Windows, use Visual Studio generator which handles finding the compiler
	if (process.platform === 'win32') {
		// Find Visual Studio installation for DIA SDK
		if (!process.env.VSINSTALLDIR) {
			// Try to find VS using vswhere or common paths
			const vswhereCmd = `"${process.env['ProgramFiles(x86)']}\\Microsoft Visual Studio\\Installer\\vswhere.exe"`;
			try {
				const { execSync } = await import('node:child_process');
				const vsPath = execSync(`${vswhereCmd} -latest -property installationPath`, { encoding: 'utf8' }).trim();
				if (vsPath && existsSync(vsPath)) {
					process.env.VSINSTALLDIR = vsPath;
					console.log(`[codelldb] Found Visual Studio at: ${vsPath}`);
				}
			} catch (e) {
				// Fallback to common paths
				const vsVersions = ['2022', '2019', '2017'];
				const vsEditions = ['Professional', 'Enterprise', 'Community', 'BuildTools'];
				for (const version of vsVersions) {
					for (const edition of vsEditions) {
						const vsPath = `C:\\Program Files\\Microsoft Visual Studio\\${version}\\${edition}`;
						if (existsSync(vsPath)) {
							process.env.VSINSTALLDIR = vsPath;
							console.log(`[codelldb] Found Visual Studio at: ${vsPath}`);
							break;
						}
					}
					if (process.env.VSINSTALLDIR) break;
				}
			}
		}

		// Use Visual Studio 17 2022 generator with appropriate architecture
		let platform = 'x64';
		if (normArch === 'arm64') {
			// We don't have arm64 LLDB package so for now rely on emulation
			platform = 'x64';
			//platform = 'ARM64';
		} else if (normArch === 'x86' || normArch === 'ia32') {
			platform = 'Win32';
		}

		cmakeArgs.push('-G', 'Visual Studio 17 2022', '-A', platform);
	} else {
		cmakeArgs.push('-G', 'Ninja');
	}

	// Toolchain from env or inferred
	const envToolchain = process.env.CODELLDB_CMAKE_TOOLCHAIN_FILE;
	const toolchain = envToolchain || resolveToolchainFile();
	if (toolchain) {
		cmakeArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${toolchain}`);
	}
	// LLDB package location from env or download (no system probing)
	let lldbPkg = process.env.CODELLDB_LLDB_PACKAGE || await downloadLatestLLDBPackage();
	if (lldbPkg) {
		cmakeArgs.push(`-DLLDB_PACKAGE=${lldbPkg}`);
	} else {
		throw new Error('LLDB package not available. Set CODELLDB_LLDB_PACKAGE or ensure auto-download works.');
	}
	// Configure
	await run('cmake', cmakeArgs);
	// Build default targets (should produce extension.js and adapter binaries under build/)
	const buildArgs = ['--build', buildDir, '--config', 'Release', '--parallel'];
	if (cmakeTarget) {
		buildArgs.push('--target', cmakeTarget);
	}
	await run('cmake', buildArgs);
	return true;
}

async function main() {
	console.log('[codelldb] Starting native build');
	if (!await tryCMakeBuild()) {
		throw new Error('[codelldb] CMake build failed');
		return;
	}
	console.log('[codelldb] CMake build succeeded');
}

main().catch(err => { console.error(`[codelldb] Build failed: ${err?.message || err}`); process.exit(1); });
