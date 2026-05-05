type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold: Level =
  (process.env.LOG_LEVEL as Level) in order
    ? (process.env.LOG_LEVEL as Level)
    : 'info';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[threshold]) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  // BigInts are not JSON-serialisable by default.
  const text = JSON.stringify(line, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
  if (level === 'error') console.error(text);
  else console.log(text);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info:  (msg: string, f?: Record<string, unknown>) => emit('info',  msg, f),
  warn:  (msg: string, f?: Record<string, unknown>) => emit('warn',  msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};
