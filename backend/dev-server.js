'use strict';
/**
 * LOCAL DEVELOPMENT SERVER ONLY. Runs the real Apps Script sources against in-memory (optionally file-persisted)
 * mocks of Google services so the React app and tests can run without a Google account. The database starts EMPTY.
 * Usage: node dev-server.js [port]   (env: DEV_PERSIST=/path/state.json to keep data between runs)
 * Never deploy this; production uses Google Apps Script (see docs/DEPLOYMENT.md).
 */
const http = require('http');
const fs = require('fs');
const { createBackend } = require('./test/harness');

const port = parseInt(process.argv[2] || process.env.PORT || '8787', 10);
const persist = process.env.DEV_PERSIST;
const be = createBackend().setup();
be.props.set('ENVIRONMENT', 'development');
if (persist && fs.existsSync(persist)) { be.restore(JSON.parse(fs.readFileSync(persist, 'utf8'))); be.run('Db.reset()'); }
if (!be.run('Auth.teacherExists()')) { be.run('generateSetupKey()'); console.log('First run — one-time setup key:', be.props.get('SETUP_KEY')); }
const save = () => { if (persist) fs.writeFileSync(persist, JSON.stringify(be.snapshot())); };

http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x'); const parameter = Object.fromEntries(url.searchParams);
  if (req.method === 'GET') {
    if (url.pathname === '/__mails') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(be.log.mails)); }   // DEV ONLY: lets tests read "sent" email
    if (url.pathname === '/__setup_key') { res.writeHead(200, cors); return res.end(be.props.get('SETUP_KEY') || ''); }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(be.rawGet(parameter));
  }
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    try { const out = be.run('doPost')({ postData: { contents: body }, parameter }); res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(out.getContent()); save(); }
    catch (e) { res.writeHead(500, cors); res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'dev server error' } })); }
  });
}).listen(port, () => console.log(`TuitionDesk DEV API on http://localhost:${port} (in-memory${persist ? ', persisted to ' + persist : ''})`));
