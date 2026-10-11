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

describe('Jules CLI Tests', { timeout: 10000 }, () => {
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
          { name: 'sessions/123', state: 'ACTIVE', createTime: '2025-01-01T00:00:00Z' }
        ]
      }
    }

    const res = await runCli(['sessions'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Fetching sessions/)
    assert.match(res.stdout, /sessions\/123/)
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

    assert.match(stdout, /Warning: Specifying `--source` is not necessary when passing a session ID/)
    assert.match(stdout, /Jules REPL started for session: sessions\/123/)
  })

  test('repl --source implicitly creates session and starts REPL', async () => {
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
      body: { name: 'sessions/sourceCreated123' }
    }
    mockResponses['GET /sessions/sourceCreated123'] = {
      status: 200,
      body: { name: 'sessions/sourceCreated123', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/sourceCreated123/activities'] = {
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

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /Jules REPL started for session: sessions\/sourceCreated123/)
  })

  test('repl --create with --session fails', async () => {
    const res = await runCli(['repl', '--create', '-s', '123'])
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
})
