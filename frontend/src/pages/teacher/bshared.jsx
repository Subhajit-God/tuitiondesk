import React, { useEffect, useState } from 'react';

/** ⓘ disclosure that explains how a metric is defined. */
export function Def({ text }) {
  return <details className="bdef"><summary aria-label="Show definition">ⓘ</summary><span className="small muted">{text}</span></details>;
}
export function Section({ title, children, hint }) { return <fieldset className="bsec"><legend>{title}</legend>{hint && <p className="hint">{hint}</p>}{children}</fieldset>; }
/** Warn when navigating away (hash change) with unsaved edits. */
export function useLeaveGuard(dirty, msg = 'You have unsaved changes. Leave without saving?') {
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => { if (!window.confirm(msg)) { e.preventDefault(); history.back(); } };
    const b = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('hashchange', h); window.addEventListener('beforeunload', b);
    return () => { window.removeEventListener('hashchange', h); window.removeEventListener('beforeunload', b); };
  }, [dirty, msg]);
}
export const Check = ({ label, checked, onChange, hint }) => (
  <label className="field"><span className="lbl"><input type="checkbox" checked={!!checked} onChange={onChange} /> {label}</span>{hint && <span className="hint">{hint}</span>}</label>
);
