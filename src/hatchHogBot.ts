import {TweetV2} from 'twitter-api-v2';
import {logger} from './utils/logger';
import {TweetService} from "./services/TweetService.ts";
import {RateLimiterService} from "./services/RateLimiterService.ts";
import {TokenInfoGeneratorService} from "./services/TokenInfoGeneratorService.ts";
import {HatchhogTokenInfo, RateLimit} from "./types.ts";

export class HatchHogBot {
  private tweetService: TweetService;
  private rateLimiter: RateLimiterService;
  private tokenInfoGeneratorService: TokenInfoGeneratorService;

  private processedTweets: Set<string>;
  private queue: TweetV2[] = [];
  private processing = false;

  constructor() {
    this.tweetService = new TweetService();
    this.rateLimiter = new RateLimiterService();
    this.tokenInfoGeneratorService = new TokenInfoGeneratorService();
    this.processedTweets = new Set<string>();
  }

  public async start() {
    try {
      logger.info('Starting bot', {}, true);

      // start time must be at least 10 seconds ago because of Twitter API rules
      const appStartTimestamp = Date.now() - 10 * 1000;
      let sinceId: string | undefined = undefined;

      while (true) {
        try {
          const startTime = new Date(Math.max(Date.now() - 5 * 60 * 1000, appStartTimestamp));
          const {tweets, newestId} = await this.tweetService.searchRecentMentions(startTime, sinceId);
          sinceId = newestId;

          for (const tweet of tweets) {
            if (!this.processedTweets.has(tweet.id) && !this.processedTweets.has(tweet.conversation_id!)) {
              this.processedTweets.add(tweet.id);
              this.processedTweets.add(tweet.conversation_id!);
              await this.addToLaunchQueue(tweet);
              logger.info('Added tweet to launch queue', {
                tweetId: tweet.id,
                conversationId: tweet.conversation_id,
                authorId: tweet.author_id,
                text: tweet.text
              }, true);
            }
          }
        } catch (error: any) {
          logger.error('Error polling tweets', {
            error: error.stack
          });
        } finally {
          // 3 seconds delay between each poll because of Twitter API rate limits
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    } catch (error: any) {
      logger.error('Error starting bot:', {
        error: error.stack
      });
      throw error;
    }
  }

  private async addToLaunchQueue(tweet: TweetV2) {
    this.queue.push(tweet);
    if (!this.processing) this.processLaunchQueue();
  }

  private async processLaunchQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    while (this.queue.length > 0) {
      const tweet = this.queue[0];
      try {
        await this.handleTweet(tweet);
      } catch (e: any) {
        logger.error('Error handling tweet from queue', {
          tweetId: tweet.id,
          error: e.stack
        });
      }
      this.queue.shift();
      await new Promise(resolve => setTimeout(resolve, 1000)); // cool down
    }
    this.processing = false;
  }

  private async handleTweet(tweet: TweetV2) {
    try {
      const rateLimit = await this.rateLimiter.checkLimits(tweet.author_id!);

      if (!(rateLimit.user.success && rateLimit.global.success)) {
        logger.debug('Rate limit exceeded', {
          tweetId: tweet.id,
          rateLimit
        }, true);
        return;
      }

      const isValidTweet = await this.tweetService.validateTweet(tweet);

      if (!isValidTweet) {
        logger.debug('Invalid tweet', {
          tweetId: tweet.id,
          authorId: tweet.author_id
        });
        return;
      }

      const descriptionAndContext = await this.tweetService.extractDescriptionAndContext(tweet);

      const hatchhogTokenInfo = await this.tokenInfoGeneratorService.generateTokenInfo(
        descriptionAndContext.description,
        descriptionAndContext.context
      );

      // TODO: launch memCoin and get launchUrl
      const launchUrl = '';

      const tweetText = this.makeTweetText(hatchhogTokenInfo, launchUrl, rateLimit.user, rateLimit.global);
      await this.tweetService.replyToTweet(tweetText, tweet.id);
      logger.info('Tweet handled successfully and replied', {
        tweetId: tweet.id,
        conversationId: tweet.conversation_id,
        authorId: tweet.author_id,
        text: tweet.text,
        reply: tweetText
      }, true);
    } catch (error: any) {
      logger.error('Error handling tweet', {
        tweetId: tweet.id,
        error: error.stack
      });
      throw error;
    }
  }

  private makeTweetText(hatchhogTokenInfo: HatchhogTokenInfo, launchUrl: string, userRateLimit: RateLimit, globalRateLimit: RateLimit) {
    const userResetMinutes = Math.ceil((userRateLimit.resetTimeInMs - Date.now()) / (1000 * 60));
    const globalResetMinutes = Math.ceil((globalRateLimit.resetTimeInMs - Date.now()) / (1000 * 60));

    const creatorDisplay = hatchhogTokenInfo.tokenReceiver
      ? `Token Creator: ${hatchhogTokenInfo.tokenReceiver.slice(0, 6)}...${hatchhogTokenInfo.tokenReceiver.slice(-4)}`
      : `Token Creator: anonymous`;

    return [
      `🎉 Congratulations! Your token "${hatchhogTokenInfo.name}" (${hatchhogTokenInfo.symbol}) has been successfully launched! 🚀`,
      '',
      `📝 ${hatchhogTokenInfo.description}`,
      '',
      creatorDisplay,
      '',
      `🔗 Launch URL: ${launchUrl}`,
      '',
      `ℹ️ Quick FYI:`,
      `👤 You can launch ${userRateLimit.remainingRequests} more tokens (refreshes in ${userResetMinutes}m)`,
      `🌐 The network can handle ${globalRateLimit.remainingRequests} more launches (refreshes in ${globalResetMinutes}m)`
    ].join('\n');
  }
}
