import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { setupVitePreloadErrorHandler } from './utils/lazyWithRetry';
import { initMobileApp } from './mobile/capacitor';

// Register global recovery handler for Vite dynamic import preload failures
setupVitePreloadErrorHandler();

// Initialize native mobile Capacitor plugins, insets, back button, and session
initMobileApp().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
