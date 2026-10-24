import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { setupVitePreloadErrorHandler } from './utils/lazyWithRetry';

// Register global recovery handler for Vite dynamic import preload failures
setupVitePreloadErrorHandler();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
