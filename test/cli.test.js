import { test, describe, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { spawn } from 'node:child_process'
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

describe('Jules CLI Tests', { timeout: 120000 }, () => {
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
    const queueDir = path.join(os.homedir(), '.jules-cache', 'queues')
    if (fs.existsSync(queueDir)) {
      try {
        fs.rmSync(queueDir, { recursive: true, force: true })
      } catch (err) {}
    }
    const stateDir = path.join(os.homedir(), '.jules-cache', 'sessions')
    if (fs.existsSync(stateDir)) {
      try {
        fs.rmSync(stateDir, { recursive: true, force: true })
      } catch (err) {}
    }
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
          JULES_POLL_INTERVAL: '10',
          ...env
        }
      })

      let stdout = ''
      let stderr = ''

      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
      }, 10000)

      proc.stdout.on('data', data => { stdout += data.toString() })
      proc.stderr.on('data', data => { stderr += data.toString() })

      proc.on('close', code => {
        clearTimeout(timer)
        resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr) })
      })
    })
  }

  function runRepl (args, steps = [], env = {}) {
    return new Promise((resolve) => {
      const proc = spawn('node', [JULES_BIN, ...args], {
        env: {
          ...process.env,
          JULES_API_KEY: 'test-key',
          JULES_API_URL: serverUrl,
          JULES_DISABLE_CACHE: 'true',
          JULES_POLL_INTERVAL: '10',
          ...env
        }
      })

      let rawStdout = ''
      let stepIdx = 0

      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
      }, 10000)

      const onData = data => {
        rawStdout += data.toString()
        const clean = stripAnsi(rawStdout)

        if (stepIdx < steps.length) {
          const currentStep = steps[stepIdx]
          if (clean.includes(currentStep.trigger)) {
            stepIdx++
            if (currentStep.input) {
              proc.stdin.write(currentStep.input + '\n')
            }
            if (currentStep.kill || stepIdx >= steps.length) {
              proc.kill('SIGKILL')
            }
          }
        }
      }

      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)

      proc.on('close', code => {
        clearTimeout(timer)
        resolve({ code, stdout: stripAnsi(rawStdout) })
      })
    })
  }

  test('test native module hooks (before, beforeEach, afterEach) executed', () => {
    assert.ok(hookEvents.includes('before'), 'before hook executed')
    assert.ok(hookEvents.includes('beforeEach'), 'beforeEach hook executed')
  })

  test('help command / default output when no command provided', async () => {
    const res = await runCli([])
    assert.strictEqual(res.code, 1)
    const out = res.stdout + res.stderr
    assert.match(out, /Jules CLI - AI Session Manager/)
    assert.match(out, /Usage: jules/)
    assert.match(out, /sessions/)
    assert.match(out, /sources/)
    assert.match(out, /cleanup/)
    assert.match(out, /create/)
    assert.match(out, /tail/)
    assert.match(out, /repl/)
    assert.match(out, /approve/)
    assert.match(out, /send/)
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
    assert.match(res.stderr, /Fetching sessions/)
    assert.match(res.stdout, /sessions\/123/)
    assert.match(res.stdout, /owner\/repo/)
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
    assert.match(res.stderr, /Fetching sources/)
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
    assert.match(res.stderr, /Cleaning up old sessions/)
    assert.match(res.stderr, /Archived:.*sessions\/old/)
    assert.match(res.stderr, /Successfully archived 1 sessions/)
  })

  test('create command fails when prompt is missing', async () => {
    const res = await runCli(['create'])
    assert.notStrictEqual(res.code, 0)
    assert.match(res.stderr + res.stdout, /(missing|Not enough|argument)/i)
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
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Jules REPL started for session')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /sessions\/new123/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'test prompt')
    assert.strictEqual(postReq.body.source, 'sources/github/owner/repo')
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

    const proc = spawn('node', [JULES_BIN, 'tail', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Hello from agent')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

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
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Tailing session: sessions/target456')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

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

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'intertail123', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('line 3')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Step Interdiff:/)
    assert.match(stdout, /\+line 3/)
  })

  test('repl command streams activity and sends message', async () => {
    mockResponses['GET /sessions/123'] = {
      status: 200,
      body: { name: 'sessions/123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/123:sendMessage'] = {
      status: 200,
      body: {}
    }

    const { stdout } = await runRepl(['repl', '123'], [
      { trigger: 'Jules REPL started for session', input: 'hello repl' },
      { trigger: 'Message sent... Agent is thinking', kill: true }
    ])

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
      body: { name: 'sessions/replCreatedNoSource', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replCreatedNoSource/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', '--create', 'no source prompt'], [
      { trigger: 'Jules REPL started for session', kill: true }
    ])

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /Jules REPL started for session: sessions\/replCreatedNoSource/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'no source prompt')
    assert.strictEqual(postReq.body.id, undefined)
  })

  test('repl --create with invalid --source fails before making create POST request', async () => {
    mockResponses['GET /sources'] = {
      status: 200,
      body: { sources: [] }
    }

    const res = await runCli(['repl', '--create', '--source', 'invalid/repo', 'my prompt'])

    assert.notStrictEqual(res.code, 0)
    assert.match(res.stderr + res.stdout, /Source not found: invalid\/repo/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.strictEqual(postReq, undefined, 'Must not create session if source resolution fails')
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
      body: { name: 'sessions/replCreated123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replCreated123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', '--create', '--source', 'owner/repo', 'initial repl prompt'], [
      { trigger: 'Jules REPL started for session', kill: true }
    ])

    assert.match(stdout, /Creating session/)
    assert.match(stdout, /Session created successfully!/)
    assert.match(stdout, /Jules REPL started for session: sessions\/replCreated123/)

    const postReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions')
    assert.ok(postReq)
    assert.strictEqual(postReq.body.prompt, 'initial repl prompt')
    assert.strictEqual(postReq.body.source, 'sources/github/owner/repo')
  })

  test('send command fails when --session flag is missing', async () => {
    const res = await runCli(['send', 'hello world'])
    assert.strictEqual(res.code, 1)
    assert.match(res.stderr, /(--session|required)/i)
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

    let rawOutput = ''
    proc.stdout.on('data', data => { rawOutput += data.toString() })
    proc.stderr.on('data', data => { rawOutput += data.toString() })

    await new Promise(resolve => proc.on('close', resolve))
    const output = stripAnsi(rawOutput)

    assert.match(output, /Sending message to session: sessions\/123/)
    assert.match(output, /Jules is done. Process exiting/)

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
    assert.match(res.stderr, /Sending message to session: sessions\/123/)
    assert.match(res.stderr, /Message sent... Waiting for Jules to complete/)
    assert.match(res.stderr, /Jules is done. Process exiting/)

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

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'prog123', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Updating Dependencies')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

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

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'patch123', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('Patch saved to:')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    const expectedFile = path.join(os.tmpdir(), 'jules-patch123.patch')
    assert.match(stdout, /Patch saved to:/)
    assert.ok(fs.existsSync(expectedFile))
    const content = fs.readFileSync(expectedFile, 'utf8')
    assert.match(content, /\+new/)
  })

  test('tail command with --git-patch attempts to apply git patch', async () => {
    mockResponses['GET /sessions/patch456'] = {
      status: 200,
      body: { name: 'sessions/patch456', state: 'ACTIVE', updateTime: '2025-01-01T00:00:01Z' }
    }
    mockResponses['GET /sessions/patch456/activities'] = {
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
                    unidiffPatch: '--- a/nonexistent_file.txt\n+++ b/nonexistent_file.txt\n@@ -1 +1 @@\n-old\n+new\n'
                  }
                }
              }
            ]
          }
        ]
      }
    }

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'patch456', '--git-patch', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('applied git patch') || clean.includes('applying git patch')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Patch saved to:/)
    assert.match(stdout, /(Automatically applied git patch|Error automatically applying git patch)/)
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

    let rawOutput = ''
    proc.stdout.on('data', data => { rawOutput += data.toString() })
    proc.stderr.on('data', data => { rawOutput += data.toString() })

    await new Promise(resolve => proc.on('close', resolve))
    const output = stripAnsi(rawOutput)

    assert.match(output, /Sending message to session: sessions\/sendStdin123/)
    assert.match(output, /Jules is done. Process exiting/)

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
      body: { name: 'sessions/replUp123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replUp123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/replUp123:sendMessage'] = {
      status: 200,
      body: {}
    }

    await runRepl(['repl', 'replUp123'], [
      { trigger: 'Jules REPL started for session', input: `/upload ${tmpFile}` },
      { trigger: 'File uploaded... Agent is thinking', kill: true }
    ])

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
      body: { name: 'sessions/replAt123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/replAt123/activities'] = {
      status: 200,
      body: { activities: [] }
    }
    mockResponses['POST /sessions/replAt123:sendMessage'] = {
      status: 200,
      body: {}
    }

    await runRepl(['repl', 'replAt123'], [
      { trigger: 'Jules REPL started for session', input: `check code @${tmpFile}` },
      { trigger: 'Message sent... Agent is thinking', kill: true }
    ])

    const sendMsgReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/replAt123:sendMessage')
    assert.ok(sendMsgReq)
    assert.match(sendMsgReq.body.prompt, /check code @/)
    assert.match(sendMsgReq.body.prompt, /print\("at test"\)/)

    fs.unlinkSync(tmpFile)
  })

  test('approve command and repl /approve command approves plan', async () => {
    mockResponses['POST /sessions/app123:approvePlan'] = {
      status: 200,
      body: {}
    }

    const res = await runCli(['approve', '-s', 'app123'])
    assert.strictEqual(res.code, 0)
    assert.match(res.stdout, /Plan approved successfully/)

    const approveReq = mockRequests.find(r => r.method === 'POST' && r.url === '/sessions/app123:approvePlan')
    assert.ok(approveReq)
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

    const proc = spawn('node', [JULES_BIN, 'tail', '-s', 'plan123', '--history'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let rawStdout = ''
    const onData = data => {
      rawStdout += data.toString()
      const clean = stripAnsi(rawStdout)
      if (clean.includes('This is a plan generated by Jules')) {
        proc.kill('SIGKILL')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    await new Promise(resolve => proc.on('close', resolve))
    const stdout = stripAnsi(rawStdout)

    assert.match(stdout, /Plan Generated \(ID: plan-123\)/)
    assert.match(stdout, /1\. \*\*Step 1\*\*: Do first step/)
    assert.match(stdout, /This is a plan generated by Jules\. Type \/approve to approve it\./)
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

    const { stdout } = await runRepl(['repl', 'replHelp123'], [
      { trigger: 'Jules REPL started for session', input: '/help' },
      { trigger: '@<filepath>', kill: true }
    ])

    assert.match(stdout, /Available REPL Commands:/)
    assert.match(stdout, /\/upload <filepath>/)
    assert.match(stdout, /\/approve/)
    assert.match(stdout, /\/rename <name>/)
    assert.match(stdout, /\/queue/)
    assert.match(stdout, /\/flush/)
    assert.match(stdout, /\/help/)
  })

  test('@filepath expansion ignores email addresses and non-path tokens', async () => {
    mockResponses['POST /sessions'] = {
      status: 200,
      body: { name: 'sessions/email123' }
    }
    mockResponses['GET /sessions/email123'] = {
      status: 200,
      body: { name: 'sessions/email123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/email123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    await runRepl(['create', 'contact me at foo@example.com for info'], [
      { trigger: 'Jules REPL started for session', kill: true }
    ])

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

    const { stdout } = await runRepl(['repl', 'label123'], [
      { trigger: 'owner/repo:label123 >', kill: true }
    ])

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

    await runRepl(['repl', 'replFlush123'], [
      { trigger: 'State: IN_PROGRESS', input: 'queued msg 1' },
      { trigger: 'Message queued', input: 'queued msg 2' },
      { trigger: 'replFlush123 [2] >', input: '/flush' },
      { trigger: 'Messages flushed and sent immediately', kill: true }
    ])

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

    await runRepl(['repl', 'feedback123'], [
      { trigger: 'State: AWAITING_USER_FEEDBACK', input: 'feedback response' },
      { trigger: 'Message sent... Agent is thinking', kill: true }
    ])

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

    const { stdout } = await runRepl(['repl', 'pull123', '--git-pull'], [
      { trigger: "Running 'git pull'", kill: true }
    ])

    assert.match(stdout, /Running 'git pull'/)
  })

  test('repl /rename command renames prompt label and overwrites source:sessionId', async () => {
    mockResponses['GET /sessions/rename123'] = {
      status: 200,
      body: { name: 'sessions/rename123', source: 'sources/github/owner/repo', state: 'ACTIVE', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/rename123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'rename123'], [
      { trigger: 'Jules REPL started for session', input: '/rename custom-session-name' },
      { trigger: 'REPL prompt renamed to: custom-session-name', kill: true }
    ])

    assert.match(stdout, /owner\/repo:rename123 >/)
    assert.match(stdout, /REPL prompt renamed to: custom-session-name/)
  })

  test('repl --name sets custom prompt label and displays queue count when busy', async () => {
    mockResponses['GET /sessions/name123'] = {
      status: 200,
      body: { name: 'sessions/name123', state: 'IN_PROGRESS', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/name123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'name123', '--name', 'my-custom-prompt'], [
      { trigger: 'State: IN_PROGRESS', input: 'queued message test' },
      { trigger: 'Message queued', kill: true }
    ])

    assert.match(stdout, /my-custom-prompt >/)
    assert.match(stdout, /my-custom-prompt \[1\] >/)
  })

  test('repl /queue command lists queued messages', async () => {
    mockResponses['GET /sessions/queue123'] = {
      status: 200,
      body: { name: 'sessions/queue123', state: 'IN_PROGRESS', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/queue123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'queue123'], [
      { trigger: 'State: IN_PROGRESS', input: 'first queued item' },
      { trigger: 'Message queued', input: '/queue' },
      { trigger: '1. first queued item', kill: true }
    ])

    assert.match(stdout, /Queued Messages \(1\):/)
    assert.match(stdout, /1\. first queued item/)
  })

  test('repl checks session state before sending directly and queues if IN_PROGRESS', async () => {
    mockResponses['GET /sessions/stateCheck123'] = {
      status: 200,
      body: { name: 'sessions/stateCheck123', state: 'IN_PROGRESS', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/stateCheck123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'stateCheck123'], [
      { trigger: 'Jules REPL started for session', input: 'test message when working' },
      { trigger: 'Jules is working. Message queued', kill: true }
    ])

    assert.match(stdout, /Jules is working\. Message queued/)
  })

  test('repl /color command changes REPL prompt color', async () => {
    mockResponses['GET /sessions/color123'] = {
      status: 200,
      body: { name: 'sessions/color123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/color123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'color123'], [
      { trigger: 'Jules REPL started for session', input: '/color cyan' },
      { trigger: 'REPL prompt color set to cyan', kill: true }
    ])

    assert.match(stdout, /REPL prompt color set to cyan/)
  })

  test('repl message queue persists to disk and restores on restart', async () => {
    const queueFile = path.join(os.homedir(), '.jules-cache', 'sessions', 'persisted999.json')
    if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile)

    mockResponses['GET /sessions/persisted999'] = {
      status: 200,
      body: { name: 'sessions/persisted999', state: 'IN_PROGRESS', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/persisted999/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    // Process 1: queue a message
    const proc1 = spawn('node', [JULES_BIN, 'repl', '-s', 'persisted999'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    await new Promise(resolve => setTimeout(resolve, 500))
    proc1.stdin.write('persisted message 1\n')
    await new Promise(resolve => setTimeout(resolve, 500))
    proc1.kill('SIGKILL')

    assert.ok(fs.existsSync(queueFile))
    const stateData = JSON.parse(fs.readFileSync(queueFile, 'utf8'))
    assert.deepStrictEqual(stateData.queue, ['persisted message 1'])

    // Process 2: start REPL and verify restored queue
    const proc2 = spawn('node', [JULES_BIN, 'repl', '-s', 'persisted999'], {
      env: {
        ...process.env,
        JULES_API_KEY: 'test-key',
        JULES_API_URL: serverUrl,
        JULES_DISABLE_CACHE: 'true'
      }
    })

    let stdout2 = ''
    proc2.stdout.on('data', data => { stdout2 += data.toString() })
    proc2.stderr.on('data', data => { stdout2 += data.toString() })

    await new Promise(resolve => setTimeout(resolve, 500))
    proc2.stdin.write('/queue\n')
    await new Promise(resolve => setTimeout(resolve, 300))
    proc2.kill('SIGKILL')

    const clean2 = stripAnsi(stdout2)
    assert.match(clean2, /Queued Messages \(1\)/)
    assert.match(clean2, /persisted message 1/)

    if (fs.existsSync(queueFile)) fs.unlinkSync(queueFile)
  })

  test('repl displays concise warning on HTTP 429 rate limit error unless DEBUG is set', async () => {
    mockResponses['GET /sessions/rate429'] = {
      status: 429,
      body: { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }
    }

    const { stdout } = await runRepl(['repl', 'rate429'], [
      { trigger: 'Rate limit reached (HTTP 429)', kill: true }
    ])

    assert.match(stdout, /Rate limit reached \(HTTP 429\)\. Retrying with backoff\.\.\./)
    assert.doesNotMatch(stdout, /RESOURCE_EXHAUSTED/)
  })

  test('repl /clear command clears console output', async () => {
    mockResponses['GET /sessions/clear123'] = {
      status: 200,
      body: { name: 'sessions/clear123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/clear123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'clear123'], [
      { trigger: 'Jules REPL started for session', input: '/clear' },
      { trigger: 'clear123 >', kill: true }
    ])

    assert.ok(stdout.includes('clear123 >'))
  })

  test('repl /web command displays opening web URL message', async () => {
    mockResponses['GET /sessions/web123'] = {
      status: 200,
      body: { name: 'sessions/web123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/web123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    const { stdout } = await runRepl(['repl', 'web123'], [
      { trigger: 'Jules REPL started for session', input: '/web' },
      { trigger: 'Opening session in browser: https://jules.google.com/session/web123', kill: true }
    ])

    assert.match(stdout, /Opening session in browser: https:\/\/jules\.google\.com\/session\/web123/)
  })

  test('repl persists prompt name and color across process restart', async () => {
    const sessionStateFile = path.join(os.homedir(), '.jules-cache', 'sessions', 'persistedstate123.json')
    if (fs.existsSync(sessionStateFile)) fs.unlinkSync(sessionStateFile)

    mockResponses['GET /sessions/persistedstate123'] = {
      status: 200,
      body: { name: 'sessions/persistedstate123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:00Z' }
    }
    mockResponses['GET /sessions/persistedstate123/activities'] = {
      status: 200,
      body: { activities: [] }
    }

    // Process 1: set name and color
    const { stdout: stdout1 } = await runRepl(['repl', 'persistedstate123'], [
      { trigger: 'Jules REPL started for session', input: '/rename my-custom-session' },
      { trigger: 'REPL prompt renamed to: my-custom-session', input: '/color cyan' },
      { trigger: 'REPL prompt color set to cyan', kill: true }
    ])

    assert.match(stdout1, /REPL prompt renamed to: my-custom-session/)
    assert.match(stdout1, /REPL prompt color set to cyan/)
    assert.ok(fs.existsSync(sessionStateFile))

    const stateData = JSON.parse(fs.readFileSync(sessionStateFile, 'utf8'))
    assert.strictEqual(stateData.name, 'my-custom-session')
    assert.strictEqual(stateData.color, 'cyan')

    // Process 2: start REPL again and verify custom prompt label restored
    const { stdout: stdout2 } = await runRepl(['repl', 'persistedstate123'], [
      { trigger: 'my-custom-session >', kill: true }
    ])

    assert.match(stdout2, /my-custom-session >/)

    if (fs.existsSync(sessionStateFile)) fs.unlinkSync(sessionStateFile)
  })

  test('repl skips past activity history by default unless --history is passed', async () => {
    mockResponses['GET /sessions/hist123'] = {
      status: 200,
      body: { name: 'sessions/hist123', state: 'AWAITING_USER_INPUT', updateTime: '2025-01-01T00:00:01Z' }
    }
    mockResponses['GET /sessions/hist123/activities'] = {
      status: 200,
      body: {
        activities: [
          {
            id: 'act1',
            type: 'agentMessaged',
            originator: 'agent',
            createTime: '2025-01-01T00:00:01Z',
            agentMessaged: { agentMessage: 'Past history message' }
          }
        ]
      }
    }

    // Default: does not print past history message
    const resDefault = await runRepl(['repl', 'hist123'], [
      { trigger: 'Jules REPL started for session', kill: true }
    ])
    assert.doesNotMatch(resDefault.stdout, /Past history message/)

    // With --history: prints past history message
    const resHistory = await runRepl(['repl', 'hist123', '--history'], [
      { trigger: 'Past history message', kill: true }
    ])
    assert.match(resHistory.stdout, /Past history message/)
  })
})
