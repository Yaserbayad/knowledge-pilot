const levels = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info') {
  const threshold = levels[level] ?? levels.info;
  const log = (name, data, message) => {
    if ((levels[name] ?? 100) < threshold) return;
    const record = {
      time: new Date().toISOString(),
      level: name,
      message,
      ...(data && typeof data === 'object' ? data : { data })
    };
    const output = JSON.stringify(record);
    if (name === 'error') console.error(output);
    else if (name === 'warn') console.warn(output);
    else console.log(output);
  };
  return {
    debug: (data, message = '') => log('debug', data, message),
    info: (data, message = '') => log('info', data, message),
    warn: (data, message = '') => log('warn', data, message),
    error: (data, message = '') => log('error', data, message)
  };
}
