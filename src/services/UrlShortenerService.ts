import axios from 'axios';
import {logger} from '../utils/logger';
import {TINYURL_API_KEY} from "../config.ts";

export class UrlShortenerService {
  private readonly API_URL = 'https://api.tinyurl.com/create';
  private readonly API_KEY: string;

  constructor() {
    this.API_KEY = TINYURL_API_KEY;
  }

  async shortenUrl(longUrl: string): Promise<string> {
    try {
      const response = await axios.post(
        this.API_URL,
        {
          url: longUrl,
          domain: "tiny.one"
        },
        {
          headers: {
            'Authorization': `Bearer ${this.API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data?.data?.tiny_url) {
        return response.data.data.tiny_url;
      }

      throw new Error('Failed to shorten URL: No tiny_url in response');
    } catch (error: any) {
      logger.error('Error shortening URL', {
        longUrl,
        error: error.stack
      });
      return longUrl;
    }
  }
}
