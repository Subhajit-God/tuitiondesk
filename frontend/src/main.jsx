import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import { loadConfig } from './api.js';

loadConfig().then(() => {
  createRoot(document.getElementById('root')).render(<App />);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost') navigator.serviceWorker.register('./sw.js').catch(() => {});
});
