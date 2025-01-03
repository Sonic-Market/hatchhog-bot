export type HatchhogTokenInfo = {
  name: string;
  symbol: string;
  description: string;
  metaUri: string;
  tokenReceiver: `0x${string}` | null;
}

export type RateLimit = {
  success: boolean;
  remainingRequests: number;
  resetTimeInMs: number;
}

export type Tweet = {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: {
    type: 'retweeted' | 'quoted' | 'replied_to';
    id: string;
  }[];
  attachments?: {
    media_keys?: string[];
    poll_ids?: string[];
  };
}

export type TwitterUser = {
  id: string;
  name: string;
  username: string;
  created_at?: string;
  public_metrics?: {
    followers_count?: number;
    following_count?: number;
    tweet_count?: number;
    listed_count?: number;
    like_count?: number;
    media_count?: number;
  };
}

export interface TwitterMedia {
  media_key: string;
  type: 'video' | 'animated_gif' | 'photo' | string;
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
}

export type TweetWithContext = {
  tweet: Tweet;
  includedTweets: Tweet[];
  includedUsers: TwitterUser[];
  includedMedia: TwitterMedia[];
}

export type TweetSearchResult = {
  tweets: TweetWithContext[];
  newestId: string | undefined;
}

export type DescriptionAndContext = {
  description: string;
  context: string;
  imageUrls: string[];
  creator: {
    id?: string | undefined;
    name?: string | undefined;
    username?: string | undefined;
    tweetId: string;
  };
}
