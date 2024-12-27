import {TweetV2} from 'twitter-api-v2';
import {logger} from './utils/logger';
import {TweetService} from "./services/TweetService.ts";
import {RateLimiterService} from "./services/RateLimiterService.ts";
import {TokenInfoGeneratorService} from "./services/TokenInfoGeneratorService.ts";
import {HatchhogService} from "./services/HatchhogService.ts";
import {HatchhogTokenInfo, RateLimit} from "./types.ts";

export class HatchhogBot {
  private tweetService: TweetService;
  private rateLimiter: RateLimiterService;
  private tokenInfoGeneratorService: TokenInfoGeneratorService;
  private hatchhogService: HatchhogService;

  private processedTweets: Set<string>;
  private queue: TweetV2[] = [];
  private processing = false;

  constructor() {
    this.tweetService = new TweetService();
    this.rateLimiter = new RateLimiterService();
    this.tokenInfoGeneratorService = new TokenInfoGeneratorService();
    this.hatchhogService = new HatchhogService();
    this.processedTweets = new Set<string>();
  }

  public async start() {
    try {
      logger.info('Starting bot', {}, true);

      // wait for 10 seconds before starting because of Twitter API rules
      await new Promise(resolve => setTimeout(resolve, 10000));

      // start time must be at least 10 seconds ago because of Twitter API rules
      const appStartTimestamp = Date.now() - 10 * 1000;
      let sinceId: string | undefined = undefined;
      let sinceIdUpdatedAt: number | undefined = undefined;

      while (true) {
        try {
          const startTime = new Date(Math.max(Date.now() - 42 * 60 * 1000, appStartTimestamp));
          if (sinceIdUpdatedAt && Date.now() - sinceIdUpdatedAt > 42 * 60 * 1000) {
            sinceId = undefined;
            sinceIdUpdatedAt = undefined;
          }
          const {tweets, newestId} = await this.tweetService.searchRecentMentions(startTime, sinceId);
          if (newestId) sinceIdUpdatedAt = Date.now();
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
          this.processLaunchQueue();
        } catch (error: any) {
          logger.error('Error polling tweets', {
            error: error.stack
          });
        } finally {
          // 15 seconds delay between each poll because of Twitter API rate limits
          await new Promise(resolve => setTimeout(resolve, 15001));
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
    this.processLaunchQueue();
  }

  private async processLaunchQueue() {
    if (this.processing) return;

    this.processing = true;
    try {
      const migratedTokens = await this.hatchhogService.migrateAll();
      if (migratedTokens.length > 0) {
        logger.info('Migrated tokens', {
          migratedTokens
        }, true);
      }
    } catch (error: any) {
      logger.error('Error migrating tokens', {
        error: error.stack
      });
    }
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
        }, true);
        return;
      }

      await this.tweetService.replyToTweet('🥚 Please wait, Your token is hatching...', tweet.id);

      const descriptionAndContext = await this.tweetService.extractDescriptionAndContext(tweet);

      const hatchhogTokenInfo = await this.tokenInfoGeneratorService.generateTokenInfo(
        descriptionAndContext.description,
        descriptionAndContext.context
      );

      const launchedTokenAddress = await this.hatchhogService.hatch(
        hatchhogTokenInfo.name,
        hatchhogTokenInfo.symbol,
        hatchhogTokenInfo.tokenReceiver,
        hatchhogTokenInfo.metaUri
      )
      const launchUrl = this.hatchhogService.getSonicMarketUrlForToken(launchedTokenAddress)

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
    const formatTimeRemaining = (milliseconds: number): string => {
      const minutes = Math.ceil((milliseconds - Date.now()) / (1000 * 60));
      if (minutes < 60) {
        return `${minutes}m`;
      }
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    };

    const userTimeDisplay = formatTimeRemaining(userRateLimit.resetTimeInMs);
    const globalTimeDisplay = formatTimeRemaining(globalRateLimit.resetTimeInMs);

    const creatorDisplay = hatchhogTokenInfo.tokenReceiver
      ? `Token Creator: ${hatchhogTokenInfo.tokenReceiver.slice(0, 6)}...${hatchhogTokenInfo.tokenReceiver.slice(-4)}`
      : `Token Creator: anonymous`;

    return [
      `🎉 Congratulations! Your token "${hatchhogTokenInfo.name}" ( $${hatchhogTokenInfo.symbol} ) has been successfully hatched 🐣`,
      '',
      `📝 ${hatchhogTokenInfo.description}`,
      '',
      creatorDisplay,
      '',
      `🔗 Launch URL: ${launchUrl}`,
      '',
      `ℹ️ Quick FYI:`,
      `👤 You can launch ${userRateLimit.remainingRequests} more tokens (refreshes in ${userTimeDisplay})`,
      `🌐 The network can handle ${globalRateLimit.remainingRequests} more launches (refreshes in ${globalTimeDisplay})`
    ].join('\n');
  }
}
