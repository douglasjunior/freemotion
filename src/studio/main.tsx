// Entry of `freemotion studio`, served by the Vite dev server with the project's compositions.
import { createRoot } from 'react-dom/client';
import compositions from 'virtual:freemotion/entry';

import { validateCompositions } from '../runtime/composition.js';

import { ErrorPanel, Studio } from './studio.js';


const root = createRoot(document.getElementById('root')!);

try {
  root.render(<Studio compositions={validateCompositions(compositions)} />);
} catch (error) {
  root.render(
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#09090d' }}>
      <ErrorPanel error={error instanceof Error ? error : new Error(String(error))} />
    </div>,
  );
}
