interface LogFields {
  [key: string]: unknown;
}

export function info(message: string, fields: LogFields = {}): void {
  console.info(JSON.stringify({ level: 'info', message, ...fields }));
}

export function warn(message: string, fields: LogFields = {}): void {
  console.warn(JSON.stringify({ level: 'warn', message, ...fields }));
}

export function error(message: string, fields: LogFields = {}): void {
  console.error(JSON.stringify({ level: 'error', message, ...fields }));
}
