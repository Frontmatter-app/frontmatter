// Must stay the first import. It renames the storage keys left by the previous
// app name, and every store below reads local storage as its module is
// evaluated — so anything imported before this one reads the old keys and
// misses them. See lib/runStorageMigration.ts.
import './lib/runStorageMigration';

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import '@excalidraw/excalidraw/index.css';
import 'katex/dist/katex.min.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
