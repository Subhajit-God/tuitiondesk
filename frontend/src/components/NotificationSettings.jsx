import React, { useCallback, useEffect, useState } from 'react';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { api, getConfig } from '../api.js';
import { Btn, useUi } from '../ui.jsx';

function firebaseApp() {
  const config = getConfig();
  if (!config?.firebase || !config?.vapidKey) {
    throw new Error('Firebase is not configured. Check the firebase and vapidKey values in config.json.');
  }
  return getApps().length ? getApp() : initializeApp(config.firebase);
}

async function messagingClient() {
  if (!(await isSupported())) {
    throw new Error('This browser does not support Firebase browser notifications.');
  }
  return getMessaging(firebaseApp());
}

export async function unregisterPushDevice() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!(await isSupported())) return;
  const messaging = await messagingClient();
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: getConfig().vapidKey, serviceWorkerRegistration: registration });
  if (token) await api('push.unregister', { token });
}

export default function NotificationSettings({ onEnabled, silent = false }) {
  const ui = useUi();
  const [supported, setSupported] = useState(null);
  const [permission, setPermission] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  const [serverStatus, setServerStatus] = useState(null);
  const [registeredHere, setRegisteredHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = useCallback(async () => {
    const result = await api('push.status', {});
    setServerStatus(result || { enabled: false, deviceCount: 0 });
    return result;
  }, []);

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};

    (async () => {
      try {
        const ok = await isSupported();
        if (!alive) return;
        setSupported(ok);

        if (typeof Notification !== 'undefined') {
          setPermission(Notification.permission);
        }
        if (!ok) return;

        try {
          await refreshStatus();
        } catch (e) {
          if (alive) setError(e?.message || 'Could not load notification registration status.');
        }

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const messaging = getMessaging(firebaseApp());
          unsubscribe = onMessage(messaging, (payload) => {
            const title = payload?.notification?.title || 'TuitionDesk';
            const body = payload?.notification?.body || payload?.data?.body || '';
            ui.ok([title, body].filter(Boolean).join(' — ') || 'New notification received.');
          });
          // Permission was granted previously: silently sync this signed-in account's device token.
          // This also prevents a shared browser from continuing to target the previous account.
          try {
            const registration = await navigator.serviceWorker.ready;
            const token = await getToken(messaging, { vapidKey: getConfig().vapidKey, serviceWorkerRegistration: registration });
            if (token) await api('push.register', { token, platform: 'web', userAgent: navigator.userAgent });
          } catch (syncError) {
            if (!silent && alive) setError(syncError?.message || 'Could not sync this device for notifications.');
          }
        }
      } catch (e) {
        if (alive) {
          setSupported(false);
          setError(e?.message || 'Notifications could not be initialized.');
        }
      }
    })();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [refreshStatus]);

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      if (!window.isSecureContext) {
        throw new Error('Notifications require HTTPS. Open the deployed TuitionDesk website over HTTPS.');
      }
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('This browser does not support web notifications.');
      }

      let permissionValue = Notification.permission;
      if (permissionValue === 'default') {
        permissionValue = await Notification.requestPermission();
      }
      setPermission(permissionValue);

      if (permissionValue !== 'granted') {
        throw new Error(permissionValue === 'denied'
          ? 'Notifications are blocked in browser settings. Allow them for this website, then try again.'
          : 'Notification permission was not granted.');
      }

      const config = getConfig();
      const messaging = await messagingClient();
      const registration = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;

      const token = await getToken(messaging, {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: registration
      });
      if (!token) throw new Error('Firebase did not return a device token. Please try again.');

      await api('push.register', {
        token,
        platform: 'web',
        userAgent: navigator.userAgent
      });
      setRegisteredHere(true);
      if (typeof onEnabled === 'function') onEnabled();
      await refreshStatus();
      ui.ok('Notifications enabled on this device.');
    } catch (e) {
      setError(e?.message || 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError('');
    try {
      const messaging = await messagingClient();
      const config = getConfig();
      const token = await getToken(messaging, {
        vapidKey: config.vapidKey,
        serviceWorkerRegistration: await navigator.serviceWorker.ready
      });

      if (token) {
        await api('push.unregister', { token });
        await deleteToken(messaging);
      }
      setRegisteredHere(false);
      await refreshStatus();
      ui.ok('Notifications disabled on this device.');
    } catch (e) {
      setError(e?.message || 'Could not disable notifications.');
    } finally {
      setBusy(false);
    }
  };

  const permissionLabel = {
    granted: 'Allowed',
    denied: 'Blocked in browser settings',
    default: 'Not yet requested',
    unsupported: 'Not available'
  }[permission] || permission;

  if (silent) return null;

  if (supported === false) {
    return <div>
      <p className="small">Browser notifications are not supported in this browser or device.</p>
      {error && <p className="ferr" role="alert">{error}</p>}
    </div>;
  }

  return (
    <div>
      <p className="small">Receive TuitionDesk updates in this browser, even when the website is not open.</p>
      <div className="small muted">Browser permission: <strong>{supported === null ? 'Checking…' : permissionLabel}</strong></div>
      {serverStatus && <div className="small muted">Active devices on this account: <strong>{Number(serverStatus.deviceCount || 0)}</strong></div>}
      {registeredHere && <p className="small">This device has been registered for notifications.</p>}
      {error && <p className="ferr" role="alert">{error}</p>}
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <Btn type="button" variant="primary" busy={busy} disabled={supported === null || permission === 'denied'} onClick={enable}>
          {permission === 'granted' ? 'Enable / sync this device' : 'Enable notifications'}
        </Btn>
        <Btn type="button" busy={busy} disabled={supported !== true || permission !== 'granted'} onClick={disable}>
          Disable on this device
        </Btn>
      </div>
      <p className="hint">You can change this permission later in your browser's site settings. Enabling notifications registers this browser with your TuitionDesk account.</p>
    </div>
  );
}
