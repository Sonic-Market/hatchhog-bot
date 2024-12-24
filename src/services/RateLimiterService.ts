import {CONFIG} from '../config';
import {RateLimit} from "../types.ts";

export class RateLimiterService {
  private userRequests: Map<string, { count: number; timestamp: number }> = new Map();
  private globalRequests: Map<string, number> = new Map();

  async checkLimits(userId: string): Promise<{
    user: RateLimit;
    global: RateLimit;
  }> {
    const userLimit = await this.checkUserLimit(userId);
    const globalLimit = await this.checkGlobalLimit();

    return {
      user: userLimit,
      global: globalLimit
    };
  }

  private async checkUserLimit(userId: string): Promise<RateLimit> {
    const now = Date.now();
    const userRecord = this.userRequests.get(userId);

    if (!userRecord || (now - userRecord.timestamp) >= CONFIG.RATE_LIMITS.USER_RESET_TIME_MS) {
      this.userRequests.set(userId, {count: 1, timestamp: now});
      return {
        success: true,
        remainingRequests: CONFIG.RATE_LIMITS.MAX_REQUESTS_PER_USER - 1,
        resetTimeInMs: now + CONFIG.RATE_LIMITS.USER_RESET_TIME_MS
      };
    }

    if (userRecord.count >= CONFIG.RATE_LIMITS.MAX_REQUESTS_PER_USER) {
      return {
        success: false,
        remainingRequests: 0,
        resetTimeInMs: userRecord.timestamp + CONFIG.RATE_LIMITS.USER_RESET_TIME_MS
      };
    }

    userRecord.count = userRecord.count + 1;
    this.userRequests.set(userId, userRecord);

    return {
      success: true,
      remainingRequests: CONFIG.RATE_LIMITS.MAX_REQUESTS_PER_USER - userRecord.count,
      resetTimeInMs: userRecord.timestamp + CONFIG.RATE_LIMITS.USER_RESET_TIME_MS
    };
  }

  private async checkGlobalLimit(): Promise<RateLimit> {
    const day = Math.floor(Date.now() / 86400000).toString();
    const count = (this.globalRequests.get(day) || 0) + 1;
    this.globalRequests.set(day, count);

    // Cleanup old days
    for (const key of this.globalRequests.keys()) {
      if (parseInt(key) < parseInt(day) - 1) this.globalRequests.delete(key);
    }

    return {
      success: count <= CONFIG.RATE_LIMITS.GLOBAL_REQUESTS_PER_DAY,
      remainingRequests: Math.max(0, CONFIG.RATE_LIMITS.GLOBAL_REQUESTS_PER_DAY - count),
      resetTimeInMs: (parseInt(day) + 1) * 86400000
    };
  }
}