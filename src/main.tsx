import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {migrateLocalStorageKeys} from './lib/storageMigration';
import './index.css';
import '@excalidraw/excalidraw/index.css';
import 'katex/dist/katex.min.css';

// Before anything reads a setting. Stores read local storage as their modules
// are evaluated, so a migration that ran inside a component would find the
// defaults already loaded and write them back over the migrated values.
migrateLocalStorageKeys();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
