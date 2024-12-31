import {TwitterApi} from 'twitter-api-v2';
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
import {DescriptionAndContext, Tweet, TweetSearchResult, TweetWithContext, TwitterUser} from "../types.ts";

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

  async searchRecentMentions(startTime: Date, sinceId?: string): Promise<TweetSearchResult> {
    const allTweets: TweetWithContext[] = [];
    let nextToken: string | undefined = undefined;
    let newestId: string | undefined = undefined;

    try {
      do {
        const result: TweetSearchRecentV2Paginator = await this.clientReadOnly.v2.search(
          `${CONFIG.BOT.HANDLE} -is:retweet`,
          {
            'tweet.fields': ['author_id', 'created_at', 'conversation_id', 'referenced_tweets', 'attachments'],
            'user.fields': ['created_at', 'public_metrics'],
            'media.fields': ['preview_image_url', 'url', 'alt_text'],
            expansions: ['referenced_tweets.id', 'author_id', 'attachments.media_keys'],
            sort_order: 'recency',
            max_results: this.PAGE_SIZE,
            start_time: sinceId ? undefined : startTime.toISOString(),
            since_id: sinceId,
            next_token: nextToken
          }
        );
        allTweets.push(
          ...result.tweets.map(tweet => ({
            tweet,
            includedTweets: result.includes.tweets || [],
            includedUsers: result.includes.users || [],
            includedMedia: result.includes.media || []
          }))
        );

        if (result.rateLimit.remaining === 0) {
          const remainingSecondsForReset = result.rateLimit.reset - Math.floor(Date.now() / 1000);
          logger.warn('Rate limit reached', {
            startTime: startTime.toISOString(),
            sinceId,
            remainingSecondsForReset
          }, remainingSecondsForReset >= 10);
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

  async validateTweet(tweetWithContext: TweetWithContext): Promise<boolean> {
    try {
      let user: TwitterUser | undefined;
      if (tweetWithContext.includedUsers) {
        user = tweetWithContext.includedUsers.find(u => u.id === tweetWithContext.tweet.author_id);
      }
      if (!user) {
        const response = await this.clientReadOnly.v2.user(tweetWithContext.tweet.author_id!, {
          'user.fields': ['created_at', 'public_metrics']
        });
        user = response.data;
        logger.warn('User not found in included users', {
          tweetId: tweetWithContext.tweet.id,
          userId: tweetWithContext.tweet.author_id,
        }, true);
      }

      const accountAge = Date.now() - new Date(user.created_at!).getTime();
      if (accountAge < CONFIG.SECURITY.MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000) {
        logger.debug('Account age validation failed', {
          id: user.id,
          name: user.name,
          username: user.username,
          age: accountAge
        }, true);
        return false;
      }

      if ((user.public_metrics!.followers_count || 0) < CONFIG.SECURITY.MIN_FOLLOWERS) {
        logger.debug('Follower count validation failed', {
          id: user.id,
          name: user.name,
          username: user.username,
          followers: user.public_metrics!.followers_count || 0,
        }, true);
        return false;
      }

      const tweetText = tweetWithContext.tweet.text.toLowerCase();
      if (CONFIG.SECURITY.BLOCKED_KEYWORDS.some(keyword => tweetText.includes(keyword))) {
        logger.debug('Blocked keywords validation failed', {
          id: user.id,
          name: user.name,
          username: user.username,
          tweetId: tweetWithContext.tweet.id,
          tweetText
        }, true);
        return false;
      }

      return true;
    } catch (e: any) {
      logger.error('Error validating tweet', {
        tweetId: tweetWithContext.tweet.id,
        error: e.stack
      });
      throw e;
    }
  }

  async extractDescriptionAndContext(tweetWithContext: TweetWithContext): Promise<DescriptionAndContext> {
    const contextTexts: string[] = [];
    const contextIds = new Set<string>();
    const mediaKeys: string[] = tweetWithContext.tweet.attachments?.media_keys || [];

    try {
      if (tweetWithContext.tweet.conversation_id! !== tweetWithContext.tweet.id) {
        contextIds.add(tweetWithContext.tweet.conversation_id!);
      }

      for (const referencedTweet of tweetWithContext.tweet.referenced_tweets || []) {
        if (referencedTweet.type === 'quoted' || referencedTweet.type === 'replied_to') {
          contextIds.add(referencedTweet.id);
        }
      }

      for (const contextTweetId of contextIds) {
        let contextTweet: Tweet | undefined;
        if (tweetWithContext.includedTweets) {
          contextTweet = tweetWithContext.includedTweets.find(t => t.id === contextTweetId);
        }
        if (!contextTweet) {
          const response = await this.clientReadOnly.v2.singleTweet(contextTweetId);
          contextTweet = response.data;
          logger.warn('Context tweet not found in included tweets', {
            tweetId: tweetWithContext.tweet.id,
            contextTweetId
          }, true);
        }
        contextTexts.push(contextTweet.text);
        mediaKeys.push(...(contextTweet.attachments?.media_keys || []));
      }
      const imageUrls: string[] = [];
      const missingMediaKeys: string[] = [];

      for (const mediaKey of mediaKeys) {
        const media = tweetWithContext.includedMedia.find(m => m.media_key === mediaKey);
        if (media) {
          const url = media.type === 'photo' ? media.url : media.preview_image_url;
          if (url) {
            imageUrls.push(url);
          }
        } else {
          missingMediaKeys.push(mediaKey);
        }
      }

      if (missingMediaKeys.length > 0) {
        try {
          const mediaResponse = await this.clientReadOnly.v2.tweets(
            Array.from(contextIds),
            {
              'tweet.fields': ['attachments'],
              'media.fields': ['preview_image_url', 'url'],
              expansions: ['attachments.media_keys'],
            }
          );

          if (mediaResponse.includes?.media) {
            mediaResponse.includes.media.forEach(media => {
              const url = media.type === 'photo' ? media.url : media.preview_image_url;
              if (url) {
                imageUrls.push(url);
              }
            });
          }
        } catch (e: any) {
          logger.warn('Error fetching missing media', {
            tweetId: tweetWithContext.tweet.id,
            missingMediaKeys,
            error: e.stack
          }, true);
        }
      }

      return {
        description: this.sanitizeTweetText(tweetWithContext.tweet.text),
        context: contextTexts.map(text => this.sanitizeTweetText(text)).join('\n'),
        imageUrls
      };
    } catch (e: any) {
      logger.error('Error extracting description and context', {
        tweetId: tweetWithContext.tweet.id,
        error: e.stack
      });
      return {
        description: this.sanitizeTweetText(tweetWithContext.tweet.text),
        context: '',
        imageUrls: []
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
    const normalizeText = (str: string) => str.replace(/\s+/g, '').trim();
    if (normalizeText(text) === normalizeText(CONFIG.BOT.TEMPLATE)) {
      return '';
    }

    return text
      .replace(CONFIG.BOT.HANDLE_REGEX, '')
      .replace(CONFIG.BOT.NAME_REGEX, 'It')
      .trim();
  }
}