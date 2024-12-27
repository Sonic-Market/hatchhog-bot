import {TweetV2, TwitterApi} from 'twitter-api-v2';
import {logger} from '../utils/logger';
import {
  CONFIG,
  TWITTER_ACCESS_TOKEN,
  TWITTER_ACCESS_TOKEN_SECRET,
  TWITTER_APP_KEY,
  TWITTER_APP_SECRET,
  TWITTER_BEARER_TOKEN
} from '../config';
import {TweetSearchRecentV2Paginator} from "twitter-api-v2/dist/esm/paginators";

export class TweetService {
  private readonly PAGE_SIZE: number = 100;
  private clientReadOnly: TwitterApi;
  private client: TwitterApi;

  constructor() {
    this.clientReadOnly = new TwitterApi(TWITTER_BEARER_TOKEN);
    this.client = new TwitterApi({
      appKey: TWITTER_APP_KEY,
      appSecret: TWITTER_APP_SECRET,
      accessToken: TWITTER_ACCESS_TOKEN,
      accessSecret: TWITTER_ACCESS_TOKEN_SECRET
    });
  }

  async searchRecentMentions(startTime: Date, sinceId?: string): Promise<{
    tweets: TweetV2[];
    newestId: string | undefined;
  }> {
    const allTweets: TweetV2[] = [];
    let nextToken: string | undefined = undefined;
    let newestId: string | undefined = undefined;

    try {
      do {
        const result: TweetSearchRecentV2Paginator = await this.clientReadOnly.v2.search(
          `${CONFIG.BOT.HANDLE} -is:retweet`,
          {
            'tweet.fields': ['author_id', 'created_at', 'conversation_id', 'referenced_tweets'],
            sort_order: 'recency',
            max_results: this.PAGE_SIZE,
            start_time: sinceId ? undefined : startTime.toISOString(),
            since_id: sinceId,
            next_token: nextToken
          }
        );
        allTweets.push(...result.tweets);

        if (result.rateLimit.remaining === 0) {
          logger.warn('Rate limit reached', {
            startTime: startTime.toISOString(),
            sinceId
          }, true);
          await new Promise(resolve => setTimeout(resolve, result.rateLimit.reset * 1000 - Date.now()));
        }

        if (result.tweets.length >= this.PAGE_SIZE && result.meta.next_token) {
          nextToken = result.meta.next_token;
        } else {
          nextToken = undefined;
        }

        if (result.tweets.length > 0 && result.meta.newest_id) {
          if (!newestId || BigInt(result.meta.newest_id) > BigInt(newestId)) {
            newestId = result.meta.newest_id;
          }
        }
      } while (nextToken);
      return {
        tweets: allTweets,
        newestId
      };
    } catch (e: any) {
      logger.error('Error searching recent mentions', {
        startTime: startTime.toISOString(),
        sinceId,
        error: e.stack
      });
      throw e;
    }
  }

  async validateTweet(tweet: TweetV2): Promise<boolean> {
    try {
      const user = await this.clientReadOnly.v2.user(tweet.author_id!, {
        'user.fields': ['created_at', 'public_metrics']
      });

      const accountAge = Date.now() - new Date(user.data.created_at!).getTime();
      if (accountAge < CONFIG.SECURITY.MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000) {
        logger.debug('Account age validation failed', {
          id: user.data.id,
          name: user.data.name,
          username: user.data.username,
          age: accountAge
        }, true);
        return false;
      }

      if ((user.data.public_metrics!.followers_count || 0) < CONFIG.SECURITY.MIN_FOLLOWERS) {
        logger.debug('Follower count validation failed', {
          id: user.data.id,
          name: user.data.name,
          username: user.data.username,
          followers: user.data.public_metrics!.followers_count || 0,
        }, true);
        return false;
      }

      const tweetText = tweet.text.toLowerCase();
      if (CONFIG.SECURITY.BLOCKED_KEYWORDS.some(keyword => tweetText.includes(keyword))) {
        logger.debug('Blocked keywords validation failed', {
          id: user.data.id,
          name: user.data.name,
          username: user.data.username,
          tweetId: tweet.id,
          tweetText
        }, true);
        return false;
      }

      return true;
    } catch (e: any) {
      logger.error('Error validating tweet', {
        tweetId: tweet.id,
        error: e.stack
      });
      throw e;
    }
  }

  async extractDescriptionAndContext(tweet: TweetV2): Promise<{
    description: string;
    context: string;
  }> {
    const contextTexts: string[] = [];
    const contextIds = new Set<string>();

    try {
      if (tweet.conversation_id! !== tweet.id) {
        contextIds.add(tweet.conversation_id!);
      }

      for (const referencedTweet of tweet.referenced_tweets || []) {
        if (referencedTweet.type === 'quoted' || referencedTweet.type === 'replied_to') {
          contextIds.add(referencedTweet.id);
        }
      }

      for (const contextTweetId of contextIds) {
        const contextTweet = await this.clientReadOnly.v2.singleTweet(contextTweetId);
        contextTexts.push(contextTweet.data.text);
      }

      return {
        description: this.sanitizeTweetText(tweet.text),
        context: contextTexts.map(text => this.sanitizeTweetText(text)).join('\n')
      };
    } catch (e: any) {
      logger.error('Error extracting description and context', {
        tweetId: tweet.id,
        error: e.stack
      });
      return {
        description: this.sanitizeTweetText(tweet.text),
        context: ''
      };
    }
  }

  async replyToTweet(text: string, replyToTweetId: string): Promise<void> {
    try {
      await this.client.v2.reply(text, replyToTweetId);
    } catch (e: any) {
      logger.error('Error replying to tweet', {
        text,
        replyToTweetId,
        error: e.stack
      });
      throw e;
    }
  }

  private sanitizeTweetText(text: string): string {
    return text.replace(CONFIG.BOT.HANDLE_REGEX, '').trim();
  }
}