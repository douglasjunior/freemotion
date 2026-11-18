import { useContextBridge } from './index.js';


it('exports the context bridge', () => {
  expect(useContextBridge).toBeTypeOf('function');
});
