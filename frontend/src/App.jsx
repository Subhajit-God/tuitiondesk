import React, { useCallback, useEffect, useState } from 'react';
import { api, getSession, setSession } from './api.js';
import { Loading, UiProvider } from './ui.jsx';
import Login from './pages/Login.jsx';
import Pay from './pages/Pay.jsx';
import Verify from './pages/Verify.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import TeacherApp from './pages/teacher/index.jsx';
import StudentApp from './pages/student/index.jsx';

/** Hash router: #/section/sub/... ; navigate('/fees') */
export function navigate(p) { location.hash = '#' + p; }
export function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean).map(decodeURIComponent);
  const [seg, set] = useState(get);
  useEffect(() => { const h = () => set(get()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return seg;
}

class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (this.state.err && prev.k !== this.props.k) this.setState({ err: null }); }
  render() { return this.state.err ? <div className="state error" role="alert"><strong>This screen could not be shown</strong><p>{String(this.state.err.message || this.state.err)}</p><a className="btn" href="#/">Go to start</a></div> : this.props.children; }
}
export default function App() {
  return <UiProvider><Boundary k={location.hash}><Root /></Boundary></UiProvider>;
}

function Root() {
  const route = useRoute();
  const [session, setSess] = useState(getSession());
  const [boot, setBoot] = useState(null); // {user, environment, centreName}
  const [loading, setLoading] = useState(!!getSession());

  const logout = useCallback(async () => { try { await api('auth.logout'); } catch { /* already gone */ } setSession(null); setSess(null); setBoot(null); navigate('/'); }, []);
  useEffect(() => { const h = () => { setSess(null); setBoot(null); }; window.addEventListener('td-session-expired', h); return () => window.removeEventListener('td-session-expired', h); }, []);
  useEffect(() => { const h = () => api('auth.me').then(setBoot).catch(() => {}); window.addEventListener('td-user-changed', h); return () => window.removeEventListener('td-user-changed', h); }, []);
  useEffect(() => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    api('auth.me').then((d) => setBoot(d)).catch(() => {}).finally(() => setLoading(false));
  }, [session]);

  if (route[0] === 'pay') return <Pay id={route[1]} />;                // public one-tap pay page (capability link), no login
  if (route[0] === 'verify') return <Verify id={route[1]} />;          // public verification page, no login needed
  if (!session) return <Login onLoggedIn={(s) => { setSession(s); setSess(s); navigate('/'); }} />;
  if (loading || !boot) return <Loading label="Opening your workspace…" />;
  const user = boot.user;
  if (user.mustChangePassword) return <ChangePassword forced onDone={() => api('auth.me').then(setBoot)} onLogout={logout} />;
  const props = { user, environment: boot.environment, centreName: boot.centreName, logout, route };
  return user.role === 'teacher' ? <TeacherApp {...props} /> : <StudentApp {...props} />;
}
