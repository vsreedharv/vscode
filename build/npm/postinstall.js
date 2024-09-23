/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { dirs } = require('./dirs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = path.dirname(path.dirname(__dirname));

function log(dir, message) {
	if (process.stdout.isTTY) {
		console.log(`\x1b[34m[${dir}]\x1b[0m`, message);
	} else {
		console.log(`[${dir}]`, message);
	}
}

function run(command, args, opts) {
	log(opts.cwd || '.', '$ ' + command + ' ' + args.join(' '));

	const result = cp.spawnSync(command, args, opts);

	if (result.error) {
		console.error(`ERR Failed to spawn process: ${result.error}`);
		process.exit(1);
	} else if (result.status !== 0) {
		console.error(`ERR Process exited with code: ${result.status}`);
		process.exit(result.status);
	}
}

/**
 * @param {string} dir
 * @param {*} [opts]
 */
function npmInstall(dir, opts) {
	opts = {
		env: { ...process.env },
		...(opts ?? {}),
		cwd: dir,
		stdio: 'inherit',
		shell: true
	};

	const command = process.env['npm_command'] || 'install';

	if (process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'] && /^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		const userinfo = os.userInfo();
		log(dir, `Installing dependencies inside container ${process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME']}...`);

		opts.cwd = root;
		if (process.env['npm_config_arch'] === 'arm64') {
			run('sudo', ['docker', 'run', '--rm', '--privileged', 'multiarch/qemu-user-static', '--reset', '-p', 'yes'], opts);
		}
		run('sudo', ['docker', 'run', '-e', 'GITHUB_TOKEN', '-v', `${process.env['VSCODE_HOST_MOUNT']}:/root/vscode`, '-v', `${process.env['VSCODE_HOST_MOUNT']}/.build/.netrc:/root/.netrc`, '-w', path.resolve('/root/vscode', dir), process.env['VSCODE_REMOTE_DEPENDENCIES_CONTAINER_NAME'], 'sh', '-c', `\"chown -R root:root ${path.resolve('/root/vscode', dir)} && npm i -g node-gyp-build && npm ci\"`], opts);
		run('sudo', ['chown', '-R', `${userinfo.uid}:${userinfo.gid}`, `${path.resolve(root, dir)}`], opts);
	} else {
		log(dir, 'Installing dependencies...');
		run(npm, [command], opts);
	}
}

function setupGlobalGypConfig() {
	const includes = `
	{
		"target_defaults": {
			"conditions": [
				["OS=='linux'", {
					"cflags_cc!": [ "-std=gnu++17" ],
					"cflags_cc": [ "-std=gnu++14" ],
				}]
			]
		}
	}
	`;

	const gypDir = path.join(os.homedir(), '.gyp');
	const includeGypiPath = path.join(gypDir, 'include.gypi');

	if (!fs.existsSync(gypDir)) {
		fs.mkdirSync(gypDir, { recursive: true });
	}

	fs.writeFileSync(includeGypiPath, includes.trim());
}

function setNpmrcConfig(dir, env) {
	const npmrcPath = path.join(root, dir, '.npmrc');
	const lines = fs.readFileSync(npmrcPath, 'utf8').split('\n');

	for (const line of lines) {
		const trimmedLine = line.trim();
		if (trimmedLine && !trimmedLine.startsWith('#')) {
			const [key, value] = trimmedLine.split('=');
			env[`npm_config_${key}`] = value.replace(/^"(.*)"$/, '$1');
		}
	}

	if (dir === 'build') {
		env['npm_config_target'] = process.versions.node;
		env['npm_config_arch'] = process.arch;
	}
}

for (let dir of dirs) {

	if (dir === '') {
		// already executed in root
		continue;
	}

	let opts;

	if (dir === 'build') {
		opts = {
			env: {
				...process.env
			},
		}
		if (process.env['CC']) { opts.env['CC'] = 'gcc'; }
		if (process.env['CXX']) { opts.env['CXX'] = 'g++'; }
		if (process.env['CXXFLAGS']) { opts.env['CXXFLAGS'] = ''; }
		if (process.env['LDFLAGS']) { opts.env['LDFLAGS'] = ''; }

		setNpmrcConfig('build', opts.env);
		npmInstall('build', opts);
		continue;
	}

	if (/^(.build\/distro\/npm\/)?remote$/.test(dir)) {
		// node modules used by vscode server
		opts = {
			env: {
				...process.env
			},
		}
		if (process.env['VSCODE_REMOTE_CC']) {
			opts.env['CC'] = process.env['VSCODE_REMOTE_CC'];
		} else {
			delete opts.env['CC'];
		}
		if (process.env['VSCODE_REMOTE_CXX']) {
			opts.env['CXX'] = process.env['VSCODE_REMOTE_CXX'];
		} else {
			delete opts.env['CXX'];
		}
		if (process.env['CXXFLAGS']) { delete opts.env['CXXFLAGS']; }
		if (process.env['CFLAGS']) { delete opts.env['CFLAGS']; }
		if (process.env['LDFLAGS']) { delete opts.env['LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_CXXFLAGS']) { opts.env['CXXFLAGS'] = process.env['VSCODE_REMOTE_CXXFLAGS']; }
		if (process.env['VSCODE_REMOTE_LDFLAGS']) { opts.env['LDFLAGS'] = process.env['VSCODE_REMOTE_LDFLAGS']; }
		if (process.env['VSCODE_REMOTE_NODE_GYP']) { opts.env['npm_config_node_gyp'] = process.env['VSCODE_REMOTE_NODE_GYP']; }

		if (process.env['VSCODE_SETUP_GLOBAL_GYP_CONFIG']) {
			setupGlobalGypConfig();
		}

		setNpmrcConfig('remote', opts.env);
	}

	npmInstall(dir, opts);
}

cp.execSync('git config pull.rebase merges');
cp.execSync('git config blame.ignoreRevsFile .git-blame-ignore-revs');
