import { createLogger } from './logger.js';


function createMockStream() {
  let output = '';
  return {
    write: (chunk: string) => {
      output += chunk;
      return true;
    },
    get output() {
      return output;
    },
  };
}

describe('createLogger', () => {
  it('writes info and done to stdout by default', () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const log = createLogger({ stdout: stdout as unknown as NodeJS.WriteStream, stderr: stderr as unknown as NodeJS.WriteStream });

    log.info('hello');
    log.done('finished');
    log.error('something failed');

    expect(stdout.output).toBe('hello\n✔ finished\n');
    expect(stderr.output).toBe('something failed\n');
  });

  it('redirects info and done to stderr when in json mode', () => {
    const stdout = createMockStream();
    const stderr = createMockStream();
    const log = createLogger({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      json: true,
    });

    log.info('hello');
    log.done('finished');
    log.error('something failed');

    expect(stdout.output).toBe('');
    expect(stderr.output).toBe('hello\n✔ finished\nsomething failed\n');
  });
});
