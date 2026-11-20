// API client. Talks to the Apps Script web app. No secrets live here: only a per-session bearer token.
let config = { apiUrl: '', publicUrl: '' };
const KEY = 'td_session_v1';

export class ApiErr extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

export async function loadConfig() {
  try { const r = await fetch('./config.json', { cache: 'no-store' }); config = { ...config, ...(await r.json()) }; } catch { /* keep defaults */ }
  return config;
}
export const getConfig = () => config;

export function getSession() { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && new Date(s.expiresAt) > new Date()) return s; } catch { /* ignore */ } return null; }
export function setSession(s) { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

async function post(body) {
  if (!config.apiUrl) throw new ApiErr('NOT_CONFIGURED', 'The app is not connected to a server. Set apiUrl in config.json.');
  let res;
  try {
    // text/plain avoids a CORS pre-flight, which Apps Script web apps cannot answer.
    res = await fetch(config.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
  } catch { throw new ApiErr('NETWORK', 'Could not reach the server. Check your internet connection and try again.'); }
  let json;
  try { json = await res.json(); } catch { throw new ApiErr('BAD_RESPONSE', 'The server sent an unexpected response.'); }
  if (!json.ok) throw new ApiErr(json.error?.code || 'ERROR', json.error?.message || 'Request failed.', json.error?.details);
  return json.data;
}

/** Authenticated call. Session expiry clears the session and notifies the app. */
export async function api(action, params = {}) {
  const s = getSession();
  try { return await post({ action, params, token: s?.token }); }
  catch (e) {
    if (e.code === 'UNAUTHENTICATED') { setSession(null); window.dispatchEvent(new Event('td-session-expired')); }
    throw e;
  }
}
export const publicCall = (action, params = {}) => post({ action, params });

export async function verifyDocument(id) { return publicCall('verify.check', { id }); }
