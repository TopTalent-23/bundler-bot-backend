import pino from 'pino';

// Detect if the OS is Windows or Linux (Ubuntu)
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';

// Default pino transport for pretty logging
let transport: any;

if (isWindows || isLinux) {
    transport = pino.transport({
        target: 'pino-pretty',
        options: {
            colorize: true, // Ensure colored output is enabled
            translateTime: 'SYS:mm-dd HH:MM:ss.l', // Custom timestamp format without timezone
            ignore: 'pid,hostname', // You can customize this to ignore fields
        },
    });
} else {
    transport = undefined; // Default logging if not Windows/Linux (fallback)
}

export const logger = pino(
    {
        level: 'trace',
        redact: ['poolKeys'],
        serializers: {
            error: pino.stdSerializers.err,
        },
        base: undefined,
    },
    transport,
);