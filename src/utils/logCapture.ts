interface LogEntry {
    level: 'log' | 'warn' | 'error' | 'info' | 'debug';
    message: string;
    timestamp: number;
}

class LogCaptureService {
    private logs: LogEntry[] = [];
    private originalConsole: { [key: string]: (...args: any[]) => void } = {};
    private isInitialized = false;

    public init() {
        if (this.isInitialized) {
            return;
        }
        this.isInitialized = true;

        const levels: LogEntry['level'][] = ['log', 'warn', 'error', 'info', 'debug'];

        levels.forEach(level => {
            this.originalConsole[level] = console[level];
            (console as any)[level] = (...args: any[]) => {
                this.originalConsole[level](...args);
                this.addLog(level, args);
            };
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.addLog('error', ['Unhandled Promise Rejection:', event.reason]);
        });

        window.addEventListener('error', (event) => {
             this.addLog('error', ['Uncaught Exception:', event.message, 'at', event.filename, ':', event.lineno]);
        });
    }

    private addLog(level: LogEntry['level'], args: any[]) {
        try {
            const message = args.map(arg => {
                if (arg instanceof Error) {
                    return `Error: ${arg.message}\n${arg.stack}`;
                }
                if (typeof arg === 'object' && arg !== null) {
                    const cache = new Set();
                    return JSON.stringify(arg, (key, value) => {
                        if (typeof value === 'object' && value !== null) {
                            if (cache.has(value)) {
                                return '[Circular Reference]';
                            }
                            cache.add(value);
                        }
                        return value;
                    }, 2);
                }
                return String(arg);
            }).join(' ');
            
            this.logs.push({
                level,
                message,
                timestamp: Date.now()
            });
            
            if (this.logs.length > 200) {
                this.logs.shift();
            }
        } catch (error) {
            this.originalConsole.error('Error capturing log:', error);
        }
    }

    public getLogs(): LogEntry[] {
        return [...this.logs];
    }
}

export const logCaptureService = new LogCaptureService();
export type { LogEntry };