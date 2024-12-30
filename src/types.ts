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

export type TweetWithContext = {
  tweet: Tweet;
  includedTweets: Tweet[];
}

export type TweetSearchResult = {
  tweets: TweetWithContext[];
  newestId: string | undefined;
}

export type DescriptionAndContext = {
  description: string;
  context: string;
}
