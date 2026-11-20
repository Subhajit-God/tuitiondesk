import React, { useCallback, useEffect, useState } from 'react';
import { api, getSession, setSession } from './api.js';
import { Loading, UiProvider } from './ui.jsx';
import Login from './pages/Login.jsx';
import Pay from './pages/Pay.jsx';
import Enquire from './pages/Enquire.jsx';
import Verify from './pages/Verify.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import TeacherApp from './pages/teacher/index.jsx';
import StudentApp from './pages/student/index.jsx';
import NotificationSettings, { unregisterPushDevice } from './components/NotificationSettings.jsx';

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
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  const logout = useCallback(async () => { try { await unregisterPushDevice(); } catch { /* best-effort device unlink */ } try { await api('auth.logout'); } catch { /* already gone */ } setSession(null); setSess(null); setBoot(null); navigate('/'); }, []);
  useEffect(() => { const h = () => { setSess(null); setBoot(null); }; window.addEventListener('td-session-expired', h); return () => window.removeEventListener('td-session-expired', h); }, []);
  useEffect(() => { const h = () => api('auth.me').then(setBoot).catch(() => {}); window.addEventListener('td-user-changed', h); return () => window.removeEventListener('td-user-changed', h); }, []);
  useEffect(() => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    api('auth.me').then((d) => setBoot(d)).catch(() => {}).finally(() => setLoading(false));
  }, [session]);

  // Invite authenticated teachers and students to enable notifications once per login.
  // The browser permission prompt itself is opened only after the user taps Enable.
  useEffect(() => {
    if (!session || loading || !boot || boot.user?.mustChangePassword) {
      setShowNotificationPrompt(false);
      return;
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setShowNotificationPrompt(false);
      return;
    }
    setShowNotificationPrompt(Notification.permission !== 'granted');
  }, [session, loading, boot]);

  if (route[0] === 'pay') return <Pay id={route[1]} />;                // public one-tap pay page (capability link), no login
  if (route[0] === 'enquire') return <Enquire />;                      // public enquiry form (when the Teacher enables it)
  if (route[0] === 'verify') return <Verify id={route[1]} />;          // public verification page, no login needed
  if (!session) return <Login onLoggedIn={(s) => { setSession(s); setSess(s); navigate('/'); }} />;
  if (loading || !boot) return <Loading label="Opening your workspace…" />;
  const user = boot.user;
  if (user.mustChangePassword) return <ChangePassword forced onDone={() => api('auth.me').then(setBoot)} onLogout={logout} />;
  const props = { user, environment: boot.environment, centreName: boot.centreName, logout, route };
  const workspace = user.role === 'teacher' ? <TeacherApp {...props} /> : <StudentApp {...props} />;

  return (
    <>
      {workspace}
      <NotificationSettings key={session?.userId || 'signed-in-user'} silent />
      {showNotificationPrompt && (
        <div
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowNotificationPrompt(false);
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(10, 20, 35, 0.68)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 18
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="td-notification-title"
            style={{
              width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
              background: 'var(--card, #fff)', color: 'var(--text, #172033)',
              borderRadius: 18, padding: 22,
              boxShadow: '0 18px 60px rgba(0,0,0,.28)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden="true">🔔</div>
              <div style={{ flex: 1 }}>
                <h2 id="td-notification-title" style={{ margin: '0 0 7px', fontSize: 21 }}>
                  Turn on TuitionDesk notifications
                </h2>
                <p className="small" style={{ margin: 0 }}>
                  Get important class, fee and account updates on this device.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close notification invitation"
                onClick={() => setShowNotificationPrompt(false)}
                style={{
                  border: 0, background: 'transparent', fontSize: 24,
                  cursor: 'pointer', lineHeight: 1, padding: 2
                }}
              >×</button>
            </div>

            {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
              <div className="hint" style={{ margin: '16px 0 8px' }}>
                Notifications are currently blocked by your browser. Open the browser's site settings for TuitionDesk, change Notifications to Allow, then reload the website. This browser will not show the permission request again until you change that setting.
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <NotificationSettings onEnabled={() => setShowNotificationPrompt(false)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setShowNotificationPrompt(false)}
              >Maybe later</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
