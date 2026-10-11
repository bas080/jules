import { test, describe, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const JULES_BIN = path.resolve('./jules')

// Helper to strip ANSI color codes from terminal output
function stripAnsi (str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

describe('Jules CLI Tests', { timeout: 30000 }, () => {
  let server
  let serverPort
  let serverUrl
  let mockRequests = []
  let mockResponses = {}
  const hookEvents = []

  before(async () => {
    hookEvents.push('before')
    // Start local mock HTTP server as a Promise
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        mockRequests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body ? JSON.parse(body) : null
        })

        // Match endpoint
        const key = `${req.method} ${req.url.split('?')[0]}`
        if (mockResponses[key]) {
          const resp = mockResponses[key]
          res.writeHead(resp.status || 200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(resp.body))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found in mock' }))
        }
      })
    })

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port
        serverUrl = `http://127.0.0.1:${serverPort}`
        resolve()
      })
    })
  })

  after(async () => {
    hookEvents.push('after')
    await new Promise((resolve) => server.close(resolve))
  })

  beforeEach(() => {
    hookEvents.push('beforeEach')
    mockRequests = []
    mockResponses = {}
  })

  afterEach(() => {
    hookEvents.push('afterEach')
  })

  function runCli (args, env = {}) {
    return new Promise((resolve) => {
      const proc = spawn('node', [JULES_BIN, ...args], {
        env: {
          ...process.env,
          JULES_API_KEY: 'test-key',
          JULES_API_URL: serverUrl,
          JULES_DISABLE_CACHE: 'true',
          ...env
        }
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', data => { stdout += data.toString() })
      proc.stderr.on('data', data => { stderr += data.toString() })

      proc.on('close', code => {
        resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) })
      })
    })
  }

  test('test native module hooks (before, beforeEach, afterEach) executed', () => {
    assert.ok(hookEvents.includes('before'), 'before hook executed')
    assert.ok(hookEvents.includes('beforeEach'), 'beforeEach hook executed')
  })

  test('verify .did/hooks/test hook exists and is executable', () => {
    const hookPath = path.resolve('.did/hooks/test')
    assert.ok(fs.existsSync(hookPath), '.did/hooks/test should exist')
    const content = fs.readFileSync(hookPath, 'utf8')
    assert.match(content, /npm t/)
  })

  test('verify .did/hooks close, done, and show hooks exist and print UI testing instructions', () => {
    for (const hookName of ['close', 'done', 'show']) {
      const hookPath = path.resolve(`.did/hooks/${hookName}`)
      assert.ok(fs.existsSync(hookPath), `.did/hooks/${hookName} should exist`)
      const output = execSync(hookPath, { encoding: 'utf8' })
      assert.match(output, /Changes to the user interface should be user tested/)
      assert.match(output, /looks and behaves perfect/)
    }
  })

  test('help command / default output when no command provided', async () => {
    const res = await runCli([])
    assert.strictEqual(res.code, 1)
    assert.match(res.stdout, /Jules CLI - AI Session Manager/)
    assert.match(res.stdout, /Usage: jules/)
    assert.match(res.stdout, /sessions/)
    assert.match(res.stdout, /sources/)
    assert.match(res.stdout, /cleanup/)
    assert.match(res.stdout, /create/)
    assert.match(res.stdout, /tail/)
    assert.match(res.stdout, /repl/)
    assert.match(res.stdout, /approve/)
    assert.match(res.stdout, /send/)
  })

  test('error when JULES_API_KEY is not set', async () => {
    const res = await runCli(['sessions'], { JULES_API_KEY: '' })
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /JULES_API_KEY.*is not set/)
  })

  test('sessions command displays session list', async () => {
    mockResponses['GET /sessions'] = {
      status: 200,
      body: {
        sessions: [
          { name: 'sessions/123', source: 'sources/github/owner/repo', state: 'ACTIVE', createTime: '2025-01-01T00:00:00Z' }
        ]
      }
    }

    const res = await runCli(['sessions'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Fetching sessions/)
    assert.match(res.stdout, /sessions\/123/)
    assert.match(res.stdout, /sources\/github\/owner\/repo/)
    assert.match(res.stdout, /ACTIVE/)
    assert.strictEqual(mockRequests.length, 1)
    assert.strictEqual(mockRequests[0].headers['x-goog-api-key'], 'test-key')
  })

  test('sources command displays sources list', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: {
        sources: [
          {
            name: 'sources/github/owner/repo',
            githubRepo: {
              owner: 'owner',
              repo: 'repo',
              defaultBranch: { displayName: 'main' }
            }
          }
        ]
      }
    }

    const res = await runCli(['sources'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Fetching sources/)
    assert.match(res.stdout, /sources\/github\/owner\/repo/)
    assert.match(res.stdout, /owner\/repo/)
    assert.match(res.stdout, /main/)
  })

  test('cleanup command archives old sessions', async () => {
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    const recentTime = new Date().toISOString()

    mockResponses['GET /sessions'] = {
      status: 200,
      body: {
        sessions: [
          { name: 'sessions/old', state: 'COMPLETED', createTime: oldTime },
          { name: 'sessions/recent', state: 'ACTIVE', createTime: recentTime }
        ]
      }
    }
    mockResponses['POST /sessions/old:archive'] = {
      status: 200,
      body: { name: 'sessions/old', state: 'ARCHIVED' }
    }

    const res = await runCli(['cleanup'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Cleaning up old sessions/)
    assert.match(res.stdout, /Archived:.*sessions\/old/)
    assert.match(res.stdout, /Successfully archived 1 sessions/)
  })

  test('create command fails when prompt is missing', async () => {
    const res = await runCli(['create'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /missing required argument 'prompt'/)
  })

  test('create command with prompt and --source flag', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: {
        sources: [
          {
            name: 'sources/github/owner/repo',
            githubRepo: { owner: 'owner', repo: 'repo' }
          }
        ]
      }
    }
    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/new123' }
    }
    mockResponses['GET /sessions/new123'] = {
      status: 200,
      body: { name: 'sessions/new123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/new123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'create', 'test prompt', '--source', 'owner/repo'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /sessions\/new123/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'test prompt')
    assert.strictEqual(postReq.body.id, 'sources/github/owner/repo')
  })

  test('tail command defaults to latest session when no ID provided', async () => {
    mockResponses['GET /sessions'] = {
      status: 200,
      body: {
        sessions: [
          { name: 'sessions/latest123', state: 'ACTIVE', createTime: '2025-01-01T00:00:00Z' }
        ]
      }
    }
    mockResponses['GET /sessions/latest123'] = {
      status: 200,
      body: { name: 'sessions/latest123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/latest123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'agentMessaged',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            agentMessaged: { agentMessage: 'Hello from agent' }
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Hello from agent')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /No session ID provided. Defaulting to latest: sessions\/latest123/)
    assert.match(stdout, /Tailing session: sessions\/latest123/)
    assert.match(stdout, /Hello from agent/)
  })

  test('tail command works with --session option', async () => {
    mockResponses['GET /sessions/target456'] = {
      status: 200,
      body: { name: 'sessions/target456', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/target456/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '--session=target456'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Tailing session: sessions/target456')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Tailing session: sessions\/target456/)
  })

  test('tail command computes and displays interdiff for consecutive patch artifacts', async () => {
    mockResponses['GET /sessions/intertail123'] = {
      status: 200,
      body: { name: 'sessions/intertail123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:02Z' }
    }
    mockResponses['GET /sessions/intertail123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'artifactGenerated',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            artifacts: [
              {
                changeSet: {
                  gitPatch: {
                    unidiffPatch: '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,2 @@\n+line 1\n+line 2\n'
                  }
                }
              }
            ]
          },
          {
            id: 'act2',
            type: 'artifactGenerated',
            originator: 'agent',
            createTime: '2025-01-01T00:00:02Z',
            artifacts: [
              {
                changeSet: {
                  gitPatch: {
                    unidiffPatch: '--- a/file.txt\n+++ b/file.txt\n@@ -0,0 +1,3 @@\n+line 1\n+line 2\n+line 3\n'
                  }
                }
              }
            ]
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'intertail123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('line 3')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Step Interdiff:/)
    assert.match(stdout, /\+line 3/)
  })

  test('repl command streams activity and sends message', async () => {
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.stdin.write('hello repl\n')
      }
      if (clean.includes('Message sent... Agent is thinking')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Jules REPL started for session: sessions\/123/)
    assert.match(stdout, /Message sent... Agent is thinking/)

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/123:sendMessage')
    assert.ok(sendMsgReq)
    assert.strictEqual(sendMsgReq.body.prompt, 'hello repl')
  })

  test('repl command works with --session option', async () => {
    mockResponses['GET /sessions/15877429925913768090'] = {
      status: 200,
      body: { name: 'sessions/15877429925913768090', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/15877429925913768090/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '--session=15877429925913768090'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Jules REPL started for session: sessions\/15877429925913768090/)
  })

  test('repl -s 123 --source prints warning and connects to session 123', async () => {
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '-s', '123', '--source', 'owner/repo'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Warning: Specifying `--source` is not necessary when passing an explicit session ID/)
    assert.match(stdout, /Jules REPL started for session: sessions\/123/)
  })

  test('repl --source connects to existing latest session for source', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: {
        sources: [
          {
            name: 'sources/github/owner/repo',
            githubRepo: { owner: 'owner', repo: 'repo' }
          }
        ]
      }
    }
    mockResponses['GET /sessions'] = {
      status: 200,
      body: {
        sessions: [
          { name: 'sessions/sourceExist123', source: 'sources/github/owner/repo', state: 'ACTIVE', createTime: '2025-01-01T00:00:00Z' }
        ]
      }
    }
    mockResponses['GET /sessions/sourceExist123'] = {
      status: 200,
      body: { name: 'sessions/sourceExist123', source: 'sources/github/owner/repo', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/sourceExist123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '--source', 'owner/repo'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Connecting to latest session for owner\/repo: sessions\/sourceExist123/)
    assert.match(stdout, /Jules REPL started for session: sessions\/sourceExist123/)
  })

  test('repl --source fails if no session exists without --create', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: {
        sources: [
          {
            name: 'sources/github/owner/repo',
            githubRepo: { owner: 'owner', repo: 'repo' }
          }
        ]
      }
    }
    mockResponses['GET /sessions'] = {
      status: 200,
      body: { sessions: [] }
    }

    const res = await runCli(['repl', '--source', 'owner/repo'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /No existing sessions found for source 'owner\/repo'\. Pass '--create <prompt>' to start a new session\./)
  })

  test('repl --create without prompt fails', async () => {
    const res = await runCli(['repl', '--create'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /A prompt argument is required when using `--create`/)
  })

  test('repl --create with --session fails', async () => {
    const res = await runCli(['repl', '--create', 'test prompt', '-s', '123'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /Cannot specify `--session` option when creating a new session/)
  })

  test('repl --create without source creates session and starts REPL', async () => {
    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/replCreatedNoSource' }
    }
    mockResponses['GET /sessions/replCreatedNoSource'] = {
      status: 200,
      body: { name: 'sessions/replCreatedNoSource', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replCreatedNoSource/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '--create', 'no source prompt'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /Jules REPL started for session: sessions\/replCreatedNoSource/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'no source prompt')
    assert.strictEqual(postReq.body.id, undefined)
  })

  test('repl --create with --source creates session and starts REPL', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: {
        sources: [
          {
            name: 'sources/github/owner/repo',
            githubRepo: { owner: 'owner', repo: 'repo' }
          }
        ]
      }
    }
    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/replCreated123' }
    }
    mockResponses['GET /sessions/replCreated123'] = {
      status: 200,
      body: { name: 'sessions/replCreated123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replCreated123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', '--create', '--source', 'owner/repo', 'initial repl prompt'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /Jules REPL started for session: sessions\/replCreated123/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'initial repl prompt')
    assert.strictEqual(postReq.body.id, 'sources/github/owner/repo')
  })

  test('send command fails when --session flag is missing', async () => {
    const res = await runCli(['send', 'hello world'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /required option '-s, --session <sessionId>' not specified/)
  })

  test('send command accepts prompt from stdin', async () => {
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/123:sendMessage'] = {
      status: 200,
      body: {}
    }
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'COMPLETED', updateTime: '2025-01-01T00:00:02Z' }
    }

    const proc = spawn('node', [JULES_BIN, 'send', '-', '-s', '123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    proc.stdin.write('prompt from stdin\n')
    proc.stdin.end()

    let rawStdout = ''
    proc.stdout.on('data', data => { rawStdout += data.toString() })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Sending message to session: sessions\/123/)
    assert.match(stdout, /Jules is done. Process exiting/)

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/123:sendMessage')
    assert.ok(sendMsgReq)
    assert.strictEqual(sendMsgReq.body.prompt, 'prompt from stdin')
  })

  test('send command sends message and tails until state becomes COMPLETED', async () => {
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'agentMessaged',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            agentMessaged: { agentMessage: 'Doing task' }
          }
        ]
      }
    }
    mockResponses['POST /sessions/123:sendMessage'] = {
      status: 200,
      body: {}
    }
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'COMPLETED', updateTime: '2025-01-01T00:00:02Z' }
    }

    const res = await runCli(['send', 'do next step', '-s', '123'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Sending message to session: sessions\/123/)
    assert.match(res.stdout, /Message sent... Waiting for Jules to complete/)
    assert.match(res.stdout, /Jules is done. Process exiting/)

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/123:sendMessage')
    assert.ok(sendMsgReq)
    assert.strictEqual(sendMsgReq.body.prompt, 'do next step')
  })

  test('progressUpdated activity renders title as H1 and description below', async () => {
    mockResponses['GET /sessions/prog123'] = {
      status: 200,
      body: { name: 'sessions/prog123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:01Z' }
    }
    mockResponses['GET /sessions/prog123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'progressUpdated',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            progressUpdated: {
              title: 'Updating Dependencies',
              description: 'Installing packages via npm'
            }
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'prog123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Updating Dependencies')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Updating Dependencies/)
    assert.match(stdout, /Installing packages via npm/)
  })

  test('git patch artifact is saved to /tmp and path is outputted', async () => {
    mockResponses['GET /sessions/patch123'] = {
      status: 200,
      body: { name: 'sessions/patch123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:01Z' }
    }
    mockResponses['GET /sessions/patch123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'artifactGenerated',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            artifacts: [
              {
                changeSet: {
                  gitPatch: {
                    unidiffPatch: '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n'
                  }
                }
              }
            ]
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'patch123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Patch saved to:')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    const expectedFile = path.join(os.tmpdir(), 'jules-patch123.patch')
    assert.match(stdout, /Patch saved to:/)
    assert.ok(fs.existsSync(expectedFile))
    const content = fs.readFileSync(expectedFile, 'utf8')
    assert.match(content, /\+new/)
  })

  test('send command exits with code 1 when state becomes FAILED', async () => {
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/123:sendMessage'] = {
      status: 200,
      body: {}
    }
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'FAILED', updateTime: '2025-01-01T00:00:02Z' }
    }

    const res = await runCli(['send', 'do next step', '--session', 'sessions/123'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /Session finished with state: FAILED/)
  })

  test('create command with @filepath attaches local file content', async () => {
    const tmpFile = path.join(os.tmpdir(), 'sample-create-test.txt')
    fs.writeFileSync(tmpFile, 'hello local file content', 'utf8')

    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/fileCreated123' }
    }
    mockResponses['GET /sessions/fileCreated123'] = {
      status: 200,
      body: { name: 'sessions/fileCreated123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/fileCreated123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'create', `initial prompt @${tmpFile}`], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.match(postReq.body.prompt, /initial prompt @/)
    assert.match(postReq.body.prompt, /hello local file content/)
    assert.match(postReq.body.prompt, /--- File: .*sample-create-test.txt ---/)

    fs.unlinkSync(tmpFile)
  })

  test('create command with non-existent or binary @filepath fails', async () => {
    const res = await runCli(['create', 'prompt @/tmp/nonexistent-file-999.txt'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /Error reading file: File not found/)

    const binFile = path.join(os.tmpdir(), 'sample-image.png')
    fs.writeFileSync(binFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const resBin = await runCli(['create', `prompt @${binFile}`])
    assert.strictEqual(resBin.code, 1)
    assert.match(resBin.stderr, /Binary\/image files are not supported/)
    fs.unlinkSync(binFile)
  })

  test('send command with stdin input (message argument omitted) sends prompt', async () => {
    mockResponses['GET /sessions/sendStdin123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/sendStdin123:sendMessage'] = {
      status: 200,
      body: {}
    }
    mockResponses['GET /sessions/sendStdin123'] = {
      status: 200,
      body: { name: 'sessions/sendStdin123', state: 'COMPLETED', updateTime: '2025-01-01T00:00:02Z' }
    }

    const proc = spawn('node', [JULES_BIN, 'send', '-s', 'sendStdin123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    proc.stdin.write('prompt from omitted argument stdin\n')
    proc.stdin.end()

    let rawStdout = ''
    proc.stdout.on('data', data => { rawStdout += data.toString() })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Sending message to session: sessions\/sendStdin123/)
    assert.match(stdout, /Jules is done. Process exiting/)

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/sendStdin123:sendMessage')
    assert.ok(sendMsgReq)
    assert.strictEqual(sendMsgReq.body.prompt, 'prompt from omitted argument stdin')
  })

  test('send command with @filepath attaches local file content', async () => {
    const tmpFile = path.join(os.tmpdir(), 'sample-send-test.js')
    fs.writeFileSync(tmpFile, 'console.log("send test");', 'utf8')

    mockResponses['GET /sessions/send123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/send123:sendMessage'] = {
      status: 200,
      body: {}
    }
    mockResponses['GET /sessions/send123'] = {
      status: 200,
      body: { name: 'sessions/send123', state: 'COMPLETED', updateTime: '2025-01-01T00:00:02Z' }
    }

    const res = await runCli(['send', `review file @${tmpFile}`, '-s', 'send123'])
    assert.strictEqual(res.code, 0)

    const sendReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/send123:sendMessage')
    assert.ok(sendReq)
    assert.match(sendReq.body.prompt, /review file @/)
    assert.match(sendReq.body.prompt, /console\.log\("send test"\);/)

    fs.unlinkSync(tmpFile)
  })

  test('repl /upload command uploads local file content', async () => {
    const tmpFile = path.join(os.tmpdir(), 'repl-upload-test.txt')
    fs.writeFileSync(tmpFile, 'upload content inside repl', 'utf8')

    mockResponses['GET /sessions/replUp123'] = {
      status: 200,
      body: { name: 'sessions/replUp123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replUp123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/replUp123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'replUp123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.stdin.write(`/upload ${tmpFile}\n`)
      }
      if (clean.includes('File uploaded... Agent is thinking')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/replUp123:sendMessage')
    assert.ok(sendMsgReq)
    assert.match(sendMsgReq.body.prompt, /upload content inside repl/)

    fs.unlinkSync(tmpFile)
  })

  test('repl @filepath expansion appends local file content', async () => {
    const tmpFile = path.join(os.tmpdir(), 'repl-at-test.py')
    fs.writeFileSync(tmpFile, 'print("at test")', 'utf8')

    mockResponses['GET /sessions/replAt123'] = {
      status: 200,
      body: { name: 'sessions/replAt123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replAt123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/replAt123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'replAt123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.stdin.write(`check code @${tmpFile}\n`)
      }
      if (clean.includes('Message sent... Agent is thinking')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/replAt123:sendMessage')
    assert.ok(sendMsgReq)
    assert.match(sendMsgReq.body.prompt, /check code @/)
    assert.match(sendMsgReq.body.prompt, /print\("at test"\)/)

    fs.unlinkSync(tmpFile)
  })

  test('approve command and repl /approve command approves plan', async () => {
    mockResponses['POST /sessions/app123:approvePlan'] = {
      status: 200,
      body: { planId: 'plan-xyz' }
    }

    const res = await runCli(['approve', 'plan-xyz', '-s', 'app123'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Plan approved successfully/)

    const approveReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/app123:approvePlan')
    assert.ok(approveReq)
    assert.strictEqual(approveReq.body.planId, 'plan-xyz')
  })

  test('planGenerated activity displays plan notice text below plan', async () => {
    mockResponses['GET /sessions/plan123'] = {
      status: 200,
      body: { name: 'sessions/plan123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:01Z' }
    }
    mockResponses['GET /sessions/plan123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'planGenerated',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            planGenerated: {
              plan: {
                id: 'plan-123',
                steps: [
                  { title: 'Step 1', description: 'Do first step' }
                ]
              }
            }
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'plan123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('This is a plan generated by Jules')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Plan Generated \(ID: plan-123\)/)
    assert.match(stdout, /1\. Step 1: Do first step/)
    assert.match(stdout, /This is a plan generated by Jules\. Type \/approve plan-123 to approve it\./)
  })

  test('repl /help command displays available REPL slash commands and CLI options', async () => {
    mockResponses['GET /sessions/replHelp123'] = {
      status: 200,
      body: { name: 'sessions/replHelp123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replHelp123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'replHelp123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.stdin.write('/help\n')
      }
      if (clean.includes('CLI Options / Flags')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Available REPL Commands:/)
    assert.match(stdout, /\/upload <filepath>/)
    assert.match(stdout, /\/approve \[planId\]/)
    assert.match(stdout, /\/flush \[message\]/)
    assert.match(stdout, /\/help/)
    assert.match(stdout, /CLI Options \/ Flags:/)
  })

  test('@filepath expansion ignores email addresses and non-path tokens', async () => {
    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/email123' }
    }
    mockResponses['GET /sessions/email123'] = {
      status: 200,
      body: { name: 'sessions/email123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/email123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'create', 'contact me at foo@example.com for info'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'contact me at foo@example.com for info')
  })

  test('repl prompt label formats as source:sessionId when source is present and sessionId when source is absent', async () => {
    mockResponses['GET /sessions/label123'] = {
      status: 200,
      body: { name: 'sessions/label123', source: 'sources/github/owner/repo', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/label123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'label123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('owner/repo:label123 >')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /owner\/repo:label123 >/)
  })

  test('repl /flush command combines queued messages with --- and sends immediately', async () => {
    mockResponses['GET /sessions/replFlush123'] = {
      status: 200,
      body: { name: 'sessions/replFlush123', state: 'IN_PROGRESS', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replFlush123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/replFlush123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'replFlush123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let step = 0
    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('State: IN_PROGRESS') && step === 0) {
        step = 1
        proc.stdin.write('queued msg 1\n')
      } else if (clean.includes('Message queued') && step === 1) {
        step = 2
        proc.stdin.write('/flush queued msg 2\n')
      } else if (clean.includes('Messages flushed and sent immediately') && step === 2) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/replFlush123:sendMessage')
    assert.ok(sendMsgReq)
    assert.match(sendMsgReq.body.prompt, /queued msg 1\n\n---\n\nqueued msg 2/)
  })

  test('repl sends message immediately when state is AWAITING_USER_FEEDBACK', async () => {
    mockResponses['GET /sessions/feedback123'] = {
      status: 200,
      body: { name: 'sessions/feedback123', state: 'AWAITING_USER_FEEDBACK', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/feedback123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/feedback123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'feedback123'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let step = 0
    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('State: AWAITING_USER_FEEDBACK') && step === 0) {
        step = 1
        proc.stdin.write('feedback response\n')
      } else if (clean.includes('Message sent... Agent is thinking') && step === 1) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/feedback123:sendMessage')
    assert.ok(sendMsgReq)
    assert.strictEqual(sendMsgReq.body.prompt, 'feedback response')
  })

  test('repl --git-pull runs git pull before starting repl', async () => {
    mockResponses['GET /sessions/pull123'] = {
      status: 200,
      body: { name: 'sessions/pull123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/pull123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const proc = spawn('node', [JULES_BIN, 'repl', 'pull123', '--git-pull'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    proc.stdout.on('data', data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes("Running 'git pull'") || clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    })

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Running 'git pull'/)
  })
})
