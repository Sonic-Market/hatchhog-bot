import {config} from 'dotenv';

config();

export const CONFIG = {
  RATE_LIMITS: {
    MAX_REQUESTS_PER_USER: 3,
    USER_RESET_TIME_MS: 24 * 60 * 60 * 1000, // 24 hours
    GLOBAL_REQUESTS_PER_DAY: 100
  },
  SECURITY: {
    MIN_ACCOUNT_AGE_DAYS: 30,
    MIN_FOLLOWERS: 30,
    BLOCKED_KEYWORDS: []
  },
  BOT: {
    handle: '@TheHatchhog',
    handleRegex: /@TheHatchhog/g
  }
};

export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY!;
export const TWITTER_APP_KEY: string = process.env.TWITTER_APP_KEY!;
export const TWITTER_APP_SECRET: string = process.env.TWITTER_APP_SECRET!;
export const TWITTER_ACCESS_TOKEN: string = process.env.TWITTER_ACCESS_TOKEN!;
export const TWITTER_ACCESS_TOKEN_SECRET: string = process.env.TWITTER_ACCESS_TOKEN_SECRET!;
export const TWITTER_BEARER_TOKEN: string = process.env.TWITTER_BEARER_TOKEN!;
export const PINATA_JWT: string = process.env.PINATA_JWT!;
export const PINATA_GATEWAY: string = process.env.PINATA_GATEWAY!;