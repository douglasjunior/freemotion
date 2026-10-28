export type Logger = {
  readonly info: (message: string) => void;
  /** A status line that replaces itself on terminals and is skipped elsewhere. */
  readonly progress: (message: string) => void;
  readonly done: (message: string) => void;
  readonly error: (message: string) => void;
};

export function createLogger({ quiet = false, stdout = process.stdout, stderr = process.stderr }: {
  readonly quiet?: boolean;
  readonly stdout?: NodeJS.WriteStream;
  readonly stderr?: NodeJS.WriteStream;
} = {}): Logger {
  const tty = Boolean(stdout.isTTY);
  let line = false;
  const clear = () => {
    if (line) {
      stdout.write('\r\x1b[2K');
      line = false;
    }
  };
  return {
    info: (message) => {
      if (!quiet) {
        clear();
        stdout.write(`${message}\n`);
      }
    },
    progress: (message) => {
      if (!quiet && tty) {
        stdout.write(`\r\x1b[2K${message}`);
        line = true;
      }
    },
    done: (message) => {
      if (!quiet) {
        clear();
        stdout.write(`✔ ${message}\n`);
      }
    },
    error: (message) => {
      clear();
      stderr.write(`${message}\n`);
    },
  };
}
