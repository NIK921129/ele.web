import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { SocketProvider } from './SocketContext.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.log('SW registration failed:', error));
  });
}

const root = ReactDOM.createRoot(document.getElementById('root'));
const app = (
  <ErrorBoundary>
    <SocketProvider>
      <App />
    </SocketProvider>
  </ErrorBoundary>
);

if (import.meta.env.DEV) {
  root.render(<React.StrictMode>{app}</React.StrictMode>);
} else {
  root.render(app);
}