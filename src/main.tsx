import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installPdfNarration } from './pdf-narration';
installPdfNarration(window.desktop);
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
