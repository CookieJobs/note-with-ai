import winston from 'winston';

const { combine, timestamp, printf, colorize, align } = winston.format;

const logFormat = printf((info) => {
  return `[${info.timestamp}] ${info.level}: ${
    typeof info.message === 'object' ? JSON.stringify(info.message, null, 2) : info.message
  }`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS',
    }),
    align(),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize({ all: true })),
    }),
  ],
});

export default logger;
