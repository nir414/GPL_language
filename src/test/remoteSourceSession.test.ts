import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from './harness';
import { RemoteSourceSession, RemoteSourceIo, getRemoteSourceSession, isSafeRemoteEntryName } from '../controller/files/remoteSourceSession';
import { getControllerProjectWriteBlock } from '../project/controllerProjectWorkspace';
import { buildLibraryGraph, gprPathInDir } from '../project/projectSources';

const GPR = 'ProjectName="App"\nProjectSource="Main.gpl"\nProjectSource="Nested\\Worker.gpl"\nProjectLibrary="Lib\\Core\\Foundation"\n';

test('remote source: FTP 트리 이름 검증도 slash·encoded traversal·Windows alias를 거부한다', () => {
	for (const name of ['Main.gpl', '공용 소스.gpl', '.hidden', 'Test 100%.gpl']) {
		assert.strictEqual(isSafeRemoteEntryName(name), true, name);
	}
	for (const name of ['', '.', '..', '../secret', 'dir/file.gpl', 'dir\\file.gpl', '%2e%2e', '%252e%252e', 'x%2fy', 'x%5cy', 'CON', 'source.gpl:ads', 'trailing.']) {
		assert.strictEqual(isSafeRemoteEntryName(name), false, name);
	}
});
function fixture(input: Record<string, string> = {
	'/GPL/App/Project.gpr': GPR,
	'/GPL/App/Main.gpl': 'Sub Main\nEnd Sub\n',
	'/GPL/App/Nested/Worker.gpl': 'Sub Work\nEnd Sub\n',
	'/GPL/Lib/Core/Foundation/Project.gpr': 'ProjectName="Foundation"\nProjectSource="Base.gpl"\n',
	'/GPL/Lib/Core/Foundation/Base.gpl': 'Public Sub Base\nEnd Sub\n',
}) {
	const files = new Map(Object.entries(input));
	const listed: string[] = [];
	const read: string[] = [];
	const io: RemoteSourceIo = {
		async list(_host, remote) {
			listed.push(remote);
			const entries = new Map<string, { name: string; isDirectory: boolean; size: number }>();
			for (const [file, contents] of files) {
				if (!file.startsWith(`${remote}/`)) { continue; }
				const relative = file.slice(remote.length + 1);
				const name = relative.split('/')[0];
				entries.set(name, { name, isDirectory: relative.includes('/'), size: relative.includes('/') ? 0 : Buffer.byteLength(contents) });
			}
			if (entries.size === 0) { throw new Error(`LIST nonexistent: ${remote}`); }
			return [...entries.values()];
		},
		async read(_host, remote) {
			read.push(remote);
			const text = files.get(remote);
			if (text === undefined) { throw new Error(`RETR nonexistent: ${remote}`); }
			return Buffer.from(text);
		},
	};
	const session = new RemoteSourceSession('192.0.2.1', '/GPL', io);
	return { files, listed, read, io, session };
}

test('remote source: 프로젝트 탐색은 메타데이터만 읽고 소스 내용은 내려받지 않는다', async () => {
	const f = fixture();
	try {
		const projects = await f.session.findProjects('/GPL');
		assert.deepStrictEqual(projects.map(project => project.projectName), ['App', 'Foundation']);
		assert.ok(f.read.every(file => file.endsWith('.gpr')));
		assert.ok(projects.every(project => project.gprPath.startsWith('/GPL/')));
		assert.strictEqual(fs.existsSync(f.session.localPath('/GPL/App/Main.gpl')), false);
	} finally { f.session.dispose(); }
});

test('remote source: 라이브러리 관계와 소스 경로는 먼저 확보하고 GPL은 요청 시에만 읽는다', async () => {
	const f = fixture();
	try {
		const project = await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.strictEqual(project.projectName, 'App');
		assert.strictEqual(project.remotePath, '/GPL/App');
		assert.strictEqual(project.sourcePaths.length, 3);
		assert.deepStrictEqual(project.unresolvedLibraries, []);
		assert.ok(fs.existsSync(project.gprPath));
		assert.ok(project.sourcePaths.every(file => !fs.existsSync(file)));
		assert.ok(f.read.every(file => /\.gpr$/i.test(file)));
		const source = await f.session.ensureSource('Nested\\Worker.gpl');
		assert.strictEqual(source?.remotePath, '/GPL/App/Nested/Worker.gpl');
		assert.strictEqual(fs.readFileSync(source!.localPath, 'utf8'), f.files.get(source!.remotePath));
		assert.strictEqual(project.sourcePaths.filter(file => fs.existsSync(file)).length, 1);
	} finally { f.session.dispose(); }
});

test('remote source: 없는 라이브러리 후보에는 LIST를 보내지 않는다', async () => {
	const f = fixture();
	try {
		await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.strictEqual(f.listed.includes('/GPL/App/Lib'), false);
		assert.ok(f.listed.includes('/GPL/Lib/Core/Foundation'));
		assert.strictEqual(new Set(f.listed).size, f.listed.length, '목록 캐시를 공유한다');
	} finally { f.session.dispose(); }
});

test('remote source: .gpr 없는 라이브러리는 목록으로 관계를 만들고 소스 내용은 읽지 않는다', async () => {
	const f = fixture({
		'/GPL/App/Project.gpr': 'ProjectName="App"\nProjectSource="Main.gpl"\nProjectLibrary="Lib\\Loose"\n',
		'/GPL/App/Main.gpl': 'Sub Main\nEnd Sub',
		'/GPL/Lib/Loose/Base.gpl': 'Public Sub Base\nEnd Sub',
	});
	try {
		const project = await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.deepStrictEqual(project.unresolvedLibraries, []);
		assert.strictEqual(project.sourcePaths.length, 2);
		assert.deepStrictEqual(f.read, ['/GPL/App/Project.gpr']);
		assert.ok(project.sourcePaths.every(file => !fs.existsSync(file)), '라이브러리의 소스 내용도 아직 내려받지 않는다');
		const libraryDir = f.session.localPath('/GPL/Lib/Loose');
		const metadata = gprPathInDir(libraryDir);
		assert.ok(metadata, 'DAP의 일반 디스크 탐색도 합성 메타데이터를 찾을 수 있다');
		const graph = buildLibraryGraph(project.gprPath, fs.readFileSync(project.gprPath, 'utf8'));
		assert.deepStrictEqual(graph.unresolved, []);
		assert.deepStrictEqual(graph.dirs, [libraryDir]);
		assert.strictEqual((await f.session.ensureSource('Base.gpl'))?.remotePath, '/GPL/Lib/Loose/Base.gpl');
	} finally { f.session.dispose(); }
});

test('remote source: 순환·중첩 라이브러리는 한 번씩 읽고 누락된 참조는 반환한다', async () => {
	const f = fixture({
		'/GPL/App/Project.gpr': 'ProjectName="App"\nProjectSource="Main.gpl"\nProjectLibrary="Lib"\n',
		'/GPL/App/Main.gpl': 'Sub Main\nEnd Sub',
		'/GPL/Lib/Project.gpr': 'ProjectName="Lib"\nProjectSource="Base.gpl"\nProjectLibrary="App"\nProjectLibrary="Missing"\n',
		'/GPL/Lib/Base.gpl': 'Sub Base\nEnd Sub',
	});
	try {
		const project = await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.strictEqual(project.sourcePaths.length, 2);
		assert.deepStrictEqual(project.unresolvedLibraries, ['Missing']);
		assert.deepStrictEqual(f.read, ['/GPL/App/Project.gpr', '/GPL/Lib/Project.gpr']);
		assert.ok(!f.listed.some(remote => remote.includes('Missing')));
	} finally { f.session.dispose(); }
});

test('remote source: 실제 FTP 대소문자를 URI와 로컬 경로에서 보존한다', async () => {
	const f = fixture();
	try {
		await f.session.prepareProject('/gpl/app/project.GPR');
		const source = f.session.resolveSource('/gpl/app/main.GPL');
		assert.strictEqual(source?.remotePath, '/GPL/App/Main.gpl');
		assert.strictEqual(source?.localPath, path.join(f.session.cacheRoot, 'App', 'Main.gpl'));
		assert.strictEqual(f.session.remotePathFromUri(source!.uri), '/GPL/App/Main.gpl');
		assert.ok(!f.listed.some(remote => remote.includes('/app')));
	} finally { f.session.dispose(); }
});

test('remote source: 원격 절대 라이브러리 경로의 루트 대소문자 차이도 해석한다', async () => {
	const f = fixture();
	f.files.set('/GPL/App/Project.gpr', GPR.replace('Lib\\Core\\Foundation', '/gpl/lib/core/foundation'));
	try {
		const project = await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.deepStrictEqual(project.unresolvedLibraries, []);
		assert.strictEqual(project.sourcePaths.length, 3);
	} finally { f.session.dispose(); }
});

test('remote source: 같은 파일 동시 읽기는 한 요청으로 합치고 refresh는 다시 읽는다', async () => {
	const f = fixture();
	try {
		await f.session.prepareProject('/GPL/App/Project.gpr');
		await Promise.all([f.session.ensureSource('Main.gpl'), f.session.ensureSource('Main.gpl'), f.session.read('/GPL/App/Main.gpl')]);
		assert.strictEqual(f.read.filter(file => file.endsWith('Main.gpl')).length, 1);
		f.files.set('/GPL/App/Main.gpl', 'new source');
		assert.strictEqual(Buffer.from(await f.session.read('/GPL/App/Main.gpl')).toString(), 'Sub Main\nEnd Sub\n');
		assert.strictEqual(Buffer.from(await f.session.read('/GPL/App/Main.gpl', true)).toString(), 'new source');
		assert.strictEqual(f.read.filter(file => file.endsWith('Main.gpl')).length, 2);
	} finally { f.session.dispose(); }
});

test('remote source: 네트워크 읽기 실패는 전달하고 다음 요청은 재시도할 수 있다', async () => {
	const f = fixture();
	try {
		const original = f.io.read;
		let fail = true;
		f.io.read = async (...args) => {
			if (fail) { fail = false; throw new Error('RETR connection lost'); }
			return original(...args);
		};
		await assert.rejects(() => f.session.read('/GPL/App/Main.gpl'), /RETR connection lost/);
		assert.strictEqual(fs.existsSync(f.session.localPath('/GPL/App/Main.gpl')), false);
		assert.ok((await f.session.read('/GPL/App/Main.gpl')).length > 0);
	} finally { f.session.dispose(); }
});

for (const operation of ['list', 'read'] as const) {
	for (const failFirst of [false, true]) {
		test(`remote source: 진행 중 ${operation} ${failFirst ? '실패' : '성공'} 뒤 refresh를 한 번 새로 조회한다`, async () => {
			const f = fixture();
			let release!: () => void;
			let started!: () => void;
			const gate = new Promise<void>(resolve => { release = resolve; });
			const ready = new Promise<void>(resolve => { started = resolve; });
			let calls = 0;
			const remote = operation === 'list' ? '/GPL' : '/GPL/App/Main.gpl';
			const original = f.io[operation].bind(f.io);
			const delayed = async (host: string, target: string) => {
				const result = await original(host, target);
				if (++calls === 1) {
					started();
					await gate;
					if (failFirst) { throw new Error('first request failed'); }
				}
				return result;
			};
			if (operation === 'list') { f.io.list = delayed as RemoteSourceIo['list']; }
			else { f.io.read = delayed as RemoteSourceIo['read']; }
			const request = (refresh = false) => operation === 'list'
				? f.session.list(remote, refresh).then(entries => entries.map(entry => entry.name).join(','))
				: f.session.read(remote, refresh).then(bytes => Buffer.from(bytes).toString());
			try {
				const first = request().then(value => value, error => String(error));
				await ready;
				f.files.set('/GPL/Added.gpl', 'new file');
				f.files.set('/GPL/App/Main.gpl', 'new source');
				const refreshed = Promise.all([request(true), request(true)]);
				// read()가 비동기 경로 확인을 마치고 진행 중 요청에 합류할 때까지 양보한다.
				await new Promise<void>(resolve => setImmediate(resolve));
				release();
				const previous = await first;
				const results = await refreshed;
				if (failFirst) { assert.match(previous, /first request failed/); }
				else { assert.ok(!previous.includes(operation === 'list' ? 'Added.gpl' : 'new source')); }
				assert.ok(results.every(value => value.includes(operation === 'list' ? 'Added.gpl' : 'new source')));
				assert.strictEqual(calls, 2, '진행 중 일반 조회 뒤 동시 새로고침은 하나의 새 FTP 조회로 합친다');
				assert.strictEqual(await request(), results[0], '최신 응답을 캐시에 보관한다');
				assert.strictEqual(calls, 2);
			} finally { release(); f.session.dispose(); }
		});
	}
	test(`remote source: 세션 종료 뒤 대기 중 ${operation} refresh를 전송하지 않는다`, async () => {
		const f = fixture();
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const ready = new Promise<void>(resolve => { started = resolve; });
		let calls = 0;
		const original = f.io[operation].bind(f.io);
		const delayed = async (host: string, target: string) => {
			calls++;
			const result = await original(host, target);
			started();
			await gate;
			return result;
		};
		if (operation === 'list') { f.io.list = delayed as RemoteSourceIo['list']; }
		else { f.io.read = delayed as RemoteSourceIo['read']; }
		const request = (refresh = false) => operation === 'list'
			? f.session.list('/GPL', refresh) : f.session.read('/GPL/App/Main.gpl', refresh);
		try {
			const first = assert.rejects(request(), /닫혔습니다/);
			await ready;
			const refreshed = assert.rejects(request(true), /닫혔습니다/);
			await new Promise<void>(resolve => setImmediate(resolve));
			f.session.dispose();
			release();
			await Promise.all([first, refreshed]);
			assert.strictEqual(calls, 1);
			assert.strictEqual(fs.existsSync(f.session.cacheRoot), false);
		} finally { release(); f.session.dispose(); }
	});
}

test('remote source: 기존 폴더의 LIST 파싱 오류를 누락된 라이브러리로 숨기지 않는다', async () => {
	const f = fixture();
	try {
		const original = f.io.list;
		let fail = true;
		f.io.list = async (...args) => {
			if (fail && args[1] === '/GPL/Lib/Core/Foundation') { fail = false; throw new Error('Unsupported listing'); }
			return original(...args);
		};
		await assert.rejects(() => f.session.prepareProject('/GPL/App/Project.gpr'), /Unsupported listing/);
		assert.strictEqual((await f.session.prepareProject('/GPL/App/Project.gpr')).sourcePaths.length, 3);
	} finally { f.session.dispose(); }
});

test('remote source: 선언된 소스가 원격에 없으면 빈 로컬 파일로 가장하지 않는다', async () => {
	const f = fixture({ '/GPL/App/Project.gpr': 'ProjectSource="Missing.gpl"\n' });
	try { await assert.rejects(() => f.session.prepareProject('/GPL/App/Project.gpr'), /선언된 원격 소스를 찾을 수 없습니다/); }
	finally { f.session.dispose(); }
});

test('remote source: 중복 basename은 거부하고 명확한 원격 경로만 허용한다', async () => {
	const f = fixture();
	f.files.set('/GPL/Lib/Core/Foundation/Main.gpl', 'Sub LibraryMain\nEnd Sub');
	try {
		await f.session.prepareProject('/GPL/App/Project.gpr');
		assert.strictEqual(f.session.resolveSource('Main.gpl'), undefined);
		assert.strictEqual(f.session.resolveSource('App/Main.gpl')?.remotePath, '/GPL/App/Main.gpl');
		assert.strictEqual(f.session.resolveSource('/GPL/Lib/Core/Foundation/Main.gpl')?.remotePath, '/GPL/Lib/Core/Foundation/Main.gpl');
		assert.strictEqual(await f.session.ensureSource('Main.gpl'), undefined);
		assert.ok(f.read.every(file => file.endsWith('.gpr')));
	} finally { f.session.dispose(); }
});

test('remote source: 다른 프로젝트를 준비하면 이전 소스의 별칭을 더 이상 선택하지 않는다', async () => {
	const f = fixture();
	f.files.set('/GPL/Other/Project.gpr', 'ProjectName="Other"\nProjectSource="Other.gpl"\n');
	f.files.set('/GPL/Other/Other.gpl', 'Sub Other\nEnd Sub');
	try {
		await f.session.prepareProject('/GPL/App/Project.gpr');
		await f.session.prepareProject('/GPL/Other/Project.gpr');
		assert.strictEqual(f.session.resolveSource('/GPL/App/Main.gpl'), undefined);
		assert.strictEqual(f.session.resolveSource('Base.gpl'), undefined);
		assert.strictEqual(f.session.resolveSource('Other.gpl')?.remotePath, '/GPL/Other/Other.gpl');
	} finally { f.session.dispose(); }
});

test('remote source: TMP 세션과 URI는 제어기·세션별로 격리하고 cache도 쓰기 금지한다', async () => {
	const a = fixture();
	const b = new RemoteSourceSession('192.0.2.2', '/GPL', a.io);
	try {
		assert.notStrictEqual(a.session.cacheRoot, b.cacheRoot);
		assert.ok(path.relative(os.tmpdir(), a.session.cacheRoot).startsWith('gpl-remote-'));
		assert.strictEqual(getRemoteSourceSession(a.session.id), a.session);
		assert.strictEqual(b.remotePathFromUri(a.session.uri('/GPL/App/Main.gpl')), undefined);
		assert.strictEqual(a.session.remotePathForLocal(b.localPath('/GPL/App/Main.gpl')), undefined);
		assert.strictEqual(getControllerProjectWriteBlock(a.session.cacheRoot, a.session.host)?.kind, 'read-only');
		assert.strictEqual(getControllerProjectWriteBlock(a.session.localPath('/GPL/App/Main.gpl'), a.session.host)?.kind, 'read-only');
	} finally { a.session.dispose(); b.dispose(); }
});

test('remote source: 루트 외부·dot segment·encoded traversal·Windows alias는 IO 전에 거부한다', async () => {
	const f = fixture();
	try {
		for (const remote of ['/GPL/../secret', '/GPL/./App', '/Outside/Main.gpl', '/GPL/%2e%2e/secret', '/GPL/%252e%252e/secret', '/GPL/x%2fy', '/GPL/x%5cy', '/GPL/Main.gpl:ads', '/GPL/CON', '/GPL/App.']) {
			assert.throws(() => f.session.localPath(remote), /안전하지|루트 밖/);
			await assert.rejects(() => f.session.read(remote), /안전하지|루트 밖/);
		}
		for (const remote of ['/GPL/../secret', '/GPL/%2e%2e/secret', '/GPL/%252e%252e/secret']) {
			assert.strictEqual(f.session.remotePathFromUri(`gpl-ftp://${f.session.id}${remote}`), undefined);
		}
		assert.deepStrictEqual(f.listed, []);
		assert.deepStrictEqual(f.read, []);
	} finally { f.session.dispose(); }
});

test('remote source: 악성 FTP 이름과 대소문자가 충돌하는 목록은 캐시에 반영하지 않는다', async () => {
	for (const names of [['../bad.gpl'], ['Safe.gpl', 'safe.gpl'], ['x/y.gpl'], ['%252e%252e']]) {
		const session = new RemoteSourceSession('192.0.2.1', '/GPL', {
			async list() { return names.map(name => ({ name, isDirectory: false, size: 0 })); },
			async read() { throw new Error('unexpected RETR'); },
		});
		try { await assert.rejects(() => session.list('/GPL'), /안전하지|모호한/); }
		finally { session.dispose(); }
	}
});

test('remote source: GPR의 루트 밖 소스·라이브러리 참조도 거부한다', async () => {
	for (const text of ['ProjectSource="..\\..\\secret.gpl"\n', 'ProjectLibrary="/Outside/Lib"\n', 'ProjectSource="%2e%2e/secret.gpl"\n']) {
		const f = fixture({ '/GPL/App/Project.gpr': text });
		try { await assert.rejects(() => f.session.prepareProject('/GPL/App/Project.gpr'), /안전하지|루트 밖/); }
		finally { f.session.dispose(); }
	}
});

test('remote source: 빈 연결 대상과 전체 FTP 루트는 세션 생성 전에 거부한다', () => {
	for (const host of ['', ' ', '192.0.2.1/path']) { assert.throws(() => new RemoteSourceSession(host, '/GPL'), /호스트/); }
	assert.throws(() => new RemoteSourceSession('192.0.2.1', '/'), /루트/);
});

test('remote source: 원격 파일로 cache의 쓰기 금지 manifest를 덮어쓸 수 없다', async () => {
	const f = fixture();
	try {
		await assert.rejects(() => f.session.read('/GPL/.gpl-controller-project.json'), /보호 메타데이터/);
		await assert.rejects(() => f.session.read('/GPL/App/.gpl-controller-project.json'), /보호 메타데이터/);
		assert.strictEqual(getControllerProjectWriteBlock(f.session.cacheRoot, f.session.host)?.kind, 'read-only');
		assert.deepStrictEqual(f.read, []);
	} finally { f.session.dispose(); }
});

test('remote source: dispose는 자신이 만든 캐시만 정리하고 registry를 해제한다', () => {
	const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'gpl-remote-owner-test-'));
	const sentinel = path.join(parent, 'keep.txt');
	fs.writeFileSync(sentinel, 'keep');
	const session = new RemoteSourceSession('192.0.2.1', '/GPL', {
		async list() { return []; }, async read() { return new Uint8Array(); },
	}, parent);
	try {
		session.dispose();
		assert.strictEqual(fs.existsSync(session.cacheRoot), false);
		assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'keep');
		assert.strictEqual(getRemoteSourceSession(session.id), undefined);
		assert.throws(() => session.uri('/GPL/App/Main.gpl'), /닫혔습니다/);
		session.dispose();
	} finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('remote source: 세션 종료 중 도착한 RETR 결과로 캐시를 다시 만들지 않는다', async () => {
	const f = fixture();
	try {
		await f.session.list('/GPL/App');
		let finish: ((bytes: Uint8Array) => void) | undefined;
		let started: (() => void) | undefined;
		const ready = new Promise<void>(resolve => { started = resolve; });
		f.io.read = async () => new Promise<Uint8Array>(resolve => { finish = resolve; started!(); });
		const pending = f.session.read('/GPL/App/Main.gpl');
		await ready;
		f.session.dispose();
		finish!(Buffer.from('late data'));
		await assert.rejects(() => pending, /닫혔습니다/);
		assert.strictEqual(fs.existsSync(f.session.cacheRoot), false);
	} finally { f.session.dispose(); }
});
