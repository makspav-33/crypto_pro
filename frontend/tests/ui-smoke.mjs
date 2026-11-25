// Run from project root: node frontend/tests/ui-smoke.mjs
// Uses installed Chrome, Node and Python; all test users/files live in a temporary database.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '../..')
const temporary = await mkdtemp(join(tmpdir(), 'digitalvault-ui-'))
const processes = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = () => new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)) }) })
const start = (executable, args, options = {}) => {
  const process = spawn(executable, args, { cwd: root, windowsHide: true, stdio: 'ignore', ...options })
  processes.push(process)
  process.on('error', error => console.error(error.message))
  return process
}
async function until(action, label) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try { if (await action()) { console.log(`PASS: ${label}`); return } } catch {}
    await sleep(100)
  }
  throw new Error(`Timed out: ${label}`)
}
let socket
try {
  const apiPort = await port(), uiPort = await port()
  const apiUrl = `http://127.0.0.1:${apiPort}`, uiUrl = `http://127.0.0.1:${uiPort}`
  start(join(root, 'backend/.venv/Scripts/python.exe'), ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(apiPort)], {
    env: { ...process.env, JWT_SECRET: randomBytes(48).toString('hex'), DATABASE_PATH: join(temporary, 'ui.db'), CORS_ORIGINS: uiUrl, JWT_TTL_MINUTES: '15' },
  })
  start(process.execPath, [join(root, 'frontend/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(uiPort)], { cwd: join(root, 'frontend'), env: { ...process.env, VITE_API_URL: apiUrl } })
  await until(async () => (await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(1000) })).ok, 'backend')
  await until(async () => (await fetch(uiUrl, { signal: AbortSignal.timeout(1000) })).ok, 'frontend')
  start(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'chrome')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'])
  let debugPort
  await until(async () => { debugPort = (await readFile(join(temporary, 'chrome/DevToolsActivePort'), 'utf8')).split('\n')[0]; return debugPort }, 'Chrome')
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`, { signal: AbortSignal.timeout(5000) })).json()
  console.log('PASS: Chrome debugging endpoint')
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Chrome WebSocket timeout')), 5000); socket.onopen = () => { clearTimeout(timer); resolve() }; socket.onerror = reject })
  console.log('PASS: Chrome WebSocket')
  let id = 0
  const pending = new Map()
  socket.onmessage = event => { const data = JSON.parse(event.data); if (pending.has(data.id)) { const callbacks = pending.get(data.id); pending.delete(data.id); data.error ? callbacks.reject(new Error(data.error.message)) : callbacks.resolve(data.result) } }
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Chrome command timeout: ${method}`)) }, 5000); pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } }); socket.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => {
    const response = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
    return response.result.value
  }
  const check = async (expression, label) => { assert.equal(await evaluate(expression), true, label) }
  const wait = async (expression, label) => { try { await until(() => evaluate(expression), label) } catch (error) { console.log('Browser diagnostics:', await evaluate(`JSON.stringify({url:location.href,body:document.body?.innerText,html:document.documentElement.outerHTML.slice(0,2000)})`)); throw error } }
  const navigate = async page => { await evaluate(`location.hash=${JSON.stringify(page)}`); await sleep(200) }
  const fill = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const proto = e instanceof HTMLSelectElement ? HTMLSelectElement.prototype : e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); })()`)
  const submit = () => evaluate(`document.querySelector('form').requestSubmit()`)
  const login = async () => { await fill('[name=email]', 'browser@example.com'); await fill('[name=password]', 'browser-password-123'); await submit(); await wait(`location.hash === '#dashboard' && !!document.querySelector('.metrics-grid')`, 'login Dashboard') }

  await cdp('Runtime.enable')
  await cdp('Page.enable')
  await cdp('Page.navigate', { url: `${uiUrl}/#profile` })
  await wait(`location.hash === '#login' && !!document.querySelector('[name=email]')`, 'private route redirects to Login')
  await navigate('register')
  await fill('[name=username]', 'browser_user'); await fill('[name=email]', 'browser@example.com'); await fill('[name=password]', 'browser-password-123'); await fill('[name=confirm]', 'browser-password-123')
  await submit()
  await wait(`location.hash === '#dashboard' && !!document.querySelector('.metrics-grid')`, 'Register automatically signs in')
  await check(`document.querySelectorAll('.logout-button').length === 1 && [...document.querySelectorAll('button')].filter(b => b.textContent.includes('Вийти')).length === 1`, 'one Logout')
  await check(`!document.body.textContent.includes('Built to understand security') && !document.querySelector('footer')`, 'no decorative footer')
  await check(`localStorage.length === 0 && sessionStorage.length === 0`, 'no credentials in browser storage')
  await evaluate(`document.querySelector('.profile-link').focus()`)
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await wait(`location.hash === '#profile' && !!document.querySelector('.profile-identity')`, 'keyboard profile navigation')
  await check(`document.querySelector('details').open === false && document.querySelector('.profile-identity').textContent.includes('browser@example.com')`, 'JWT collapsed and real profile')

  await navigate('lab')
  await fill('textarea', 'Hello Привіт! 123'); await fill('.crypto-form input', '3')
  await submit()
  await wait(`!!document.querySelector('.visualization-source')`, 'Crypto Lab visualization')
  await check(`document.querySelector('.visualization-source').textContent.includes('Hello Привіт! 123') && document.querySelector('details.crypto-step').open`, 'source and first step visible')
  await evaluate(`document.querySelector('details.crypto-step summary').click()`)
  await check(`!document.querySelector('details.crypto-step').open`, 'interactive step collapse')
  await evaluate(`document.querySelector('[data-algorithm=combined]').click()`); await fill('.crypto-form input', '1324'); await submit()
  await wait(`document.querySelectorAll('details.crypto-step').length === 2`, 'combined intermediate steps')

  await navigate('files')
  const filePath = join(temporary, 'sample.txt')
  await writeFile(filePath, 'Hello Привіт!\r\n123')
  await cdp('DOM.enable')
  const document = await cdp('DOM.getDocument')
  const input = await cdp('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' })
  await cdp('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filePath] })
  await wait(`!!document.querySelector('.selected-file')`, 'TXT selected')
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: temporary })
  await submit()
  await wait(`!!document.querySelector('.upload-success')`, 'file processed')
  await evaluate(`document.querySelector('.selected-file button').click()`)
  await check(`!document.querySelector('.selected-file')`, 'clear selected file')
  await navigate('history')
  await wait(`document.querySelectorAll('.history-table tbody tr').length === 3`, 'History records real operations')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await navigate('lab')
  await check(`document.documentElement.scrollWidth <= innerWidth`, 'mobile layout has no horizontal overflow')
  await evaluate(`document.querySelector('.mobile-menu').click()`)
  await check(`document.querySelector('.sidebar').classList.contains('open')`, 'mobile menu opens')
  await evaluate(`document.querySelector('.logout-button').click()`)
  await wait(`location.hash === '#login' && !!document.querySelector('[name=email]')`, 'Logout Login')
  await login()
  await cdp('Page.reload')
  await wait(`location.hash === '#login' && !!document.querySelector('[name=email]')`, 'reload requires login')
  await navigate('register')
  await fill('[name=username]', 'duplicate'); await fill('[name=email]', 'browser@example.com'); await fill('[name=password]', 'browser-password-123'); await fill('[name=confirm]', 'browser-password-123'); await submit()
  await wait(`!!document.querySelector('[role=alert]')`, 'duplicate email error')
  await check(`location.hash === '#register' && !document.querySelector('.sidebar')`, 'duplicate registration creates no session')
  await navigate('login'); await login()
  console.log('PASS: Register auto-login, Login, Logout, reload protection, duplicate email, profile keyboard navigation, collapsed JWT, Crypto Lab steps, TXT upload/removal, History, mobile layout.')
} finally {
  socket?.close()
  for (const child of processes.reverse()) {
    if (child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', timeout: 5000 })
  }
  console.log(`Test artifacts (isolated database and browser profile): ${temporary}`)
}
