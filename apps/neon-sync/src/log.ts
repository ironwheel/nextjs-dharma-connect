// Under systemd, journald adds its own timestamps.
const withTimestamp = !process.env.INVOCATION_ID;

function write(stream: NodeJS.WriteStream, level: string, message: string): void {
  const prefix = withTimestamp ? `${new Date().toISOString()} ${level}` : level;
  stream.write(`${prefix} ${message}\n`);
}

export const log = {
  info: (message: string) => write(process.stdout, 'INFO', message),
  warn: (message: string) => write(process.stderr, 'WARN', message),
  error: (message: string) => write(process.stderr, 'ERROR', message),
};
