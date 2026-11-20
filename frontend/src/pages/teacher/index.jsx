import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Loading, Page } from '../../ui.jsx';
import { navigate } from '../../App.jsx';
import { useApi } from '../../ui.jsx';


const pages = {
  today: lazy(() => import('./Today.jsx')),
  plans: lazy(() => import('./Plans.jsx')),
  dashboard: lazy(() => import('./Dashboard.jsx')),
  students: lazy(() => import('./Students.jsx')),
  batches: lazy(() => import('./Batches.jsx')),
  fees: lazy(() => import('./Fees.jsx')),
  attendance: lazy(() => import('./Attendance.jsx')),
  tests: lazy(() => import('./Tests.jsx')),
  homework: lazy(() => import('./Homework.jsx')),
  timetable: lazy(() => import('./Timetable.jsx')),
  enquiries: lazy(() => import('./Enquiries.jsx')),
  notices: lazy(() => import('./Notices.jsx')),
  documents: lazy(() => import('./Documents.jsx')),
  settings: lazy(() => import('./Settings.jsx')),
  audit: lazy(() => import('./AuditBackup.jsx')),
  export: lazy(() => import('./Export.jsx')),
  account: lazy(() => import('./Security.jsx')),
};
export const NAV = [['today', 'Today', '☀'], ['dashboard', 'Dashboard', '▦'], ['students', 'Students', '☺'], ['batches', 'Batches', '☰'], ['fees', 'Fees & Payments', '₹'], ['plans', 'Fee plans', '☷'], ['attendance', 'Attendance', '✔'], ['tests', 'Tests & Results', '✎'], ['homework', 'Homework', '✐'],
  ['timetable', 'Timetable', '◷'], ['enquiries', 'Enquiries, Admissions & Leavers', '✉'], ['notices', 'Notices & Notifications', '✆'], ['documents', 'Official Documents', '▤'], ['settings', 'Settings', '⚙'], ['audit', 'Audit Logs & Backups', '⛨'], ['export', 'Data Export', '⇩']];

export default function TeacherApp({ user, environment, centreName, logout, route }) {
  const [open, setOpen] = useState(false);
  const key = route[0] || 'today';
  const bk = useApi('backup.status', {}, [key]);
  useEffect(() => setOpen(false), [key]);
  useEffect(() => { document.title = (NAV.find((n) => n[0] === key)?.[1] || 'TuitionDesk') + ' · ' + (centreName || 'TuitionDesk'); }, [key, centreName]);
  const Page_ = pages[key];
  return (
    <div className="shell">
      {environment !== 'production' && <div className="envbar" role="note">TEST ENVIRONMENT ({environment}) — not live data</div>}
      <header className="topbar"><button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button><span className="title">{centreName || 'TuitionDesk'}</span><span className="who">{user.displayName}</span><button className="btn small" onClick={logout}>Sign out</button></header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <nav className={'nav' + (open ? ' open' : '')} aria-label="Main">
        <div className="brand">TuitionDesk</div>
        {NAV.map(([k, l, ic]) => <a key={k} href={'#/' + k} className={key === k ? 'on' : ''} aria-current={key === k ? 'page' : undefined}><span aria-hidden="true">{ic}</span>{l}</a>)}
        <a href="#/account" className={key === 'account' ? 'on' : ''}><span aria-hidden="true">🔑</span>Password & security</a>
      </nav>
      <main className="main">
        {!user.mfaEnabled && key !== 'account' && <p className="banner warn" role="note">Two-step sign-in is off. <a href="#/account">Turn it on</a> to protect student and fee records.</p>}
        {bk.data && bk.data.warnings.length > 0 && key !== 'audit' && key !== 'today' && bk.data.warnings.map((w) => <p key={w.code} className={'banner ' + (w.level === 'error' ? 'bad' : 'warn')} role="alert">{w.message} <a href="#/audit">Open backups</a></p>)}
        <Suspense fallback={<Loading />}>
          {Page_ ? <Page_ route={route} /> : <Page title="Not found"><p>That page does not exist. <a href="#/dashboard" onClick={() => navigate('/dashboard')}>Go to the dashboard</a>.</p></Page>}
        </Suspense>
      </main>
    </div>
  );
}
