import OpenAI from 'openai';
import {logger} from '../utils/logger';
import {OPENAI_API_KEY, PINATA_GATEWAY, PINATA_JWT} from '../config';
import {HatchhogTokenInfo} from "../types.ts";
import {PinataSDK} from 'pinata-web3';
import {v4 as uuidv4} from 'uuid';

type TokenInfoDetails = {
  name: string;
  symbol: string;
  description: string;
};

export class TokenInfoGeneratorService {
  private aiClient: OpenAI;
  private pinata: PinataSDK;
  private tokenInfoDetailsJsonSchemaForAiClient = {
    type: "object",
    properties: {
      name: {type: "string"},
      symbol: {type: "string"},
      description: {type: "string"},
    },
    additionalProperties: false,
    required: ["name", "symbol", "description"]
  };

  constructor() {
    this.aiClient = new OpenAI({
      apiKey: OPENAI_API_KEY,
    });
    this.pinata = new PinataSDK({
      pinataJwt: PINATA_JWT,
      pinataGateway: PINATA_GATEWAY
    });
  }

  public async generateTokenInfo(description: string, context: string): Promise<HatchhogTokenInfo> {
    try {
      const tokenReceiver = this.extractWalletAddress(description);
      const generatedTokenInfoDetails = await this.generateTokenInfoDetails(description, context);
      const imageBase64 = await this.generateTokenImage(generatedTokenInfoDetails);
      const metaUri = await this.uploadToIpfs(imageBase64, generatedTokenInfoDetails);

      return {
        ...generatedTokenInfoDetails,
        metaUri,
        tokenReceiver
      };
    } catch (error: any) {
      logger.error('Error generating token info', {
        description,
        context,
        error: error.stack
      });
      throw error;
    }
  }

  private extractWalletAddress(context: string): `0x${string}` | null {
    const walletRegex = /(0x[a-fA-F0-9]{40})/;
    const walletMatch = context.match(walletRegex);
    return walletMatch ? walletMatch[0] as `0x${string}` : null;
  }

  private async generateTokenInfoDetails(description: string, context: string): Promise<TokenInfoDetails> {
    const contextPrompt = context.length > 0 ? `
      Additional context(description is reply tweet of context):
      "${context}"
    ` : '';
    const detailsPrompt = `
      Create a meme cryptocurrency based on the following description:
      "${description}"

      ${contextPrompt}

      Generate a creative name, symbol, and description that match the theme.
      Format the response as a JSON object with:
      - name (string)
      - symbol (4 letters max)
      - description (string)
    `;

    const detailsResponse = await this.aiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are a creative meme coin generator that creates fun and engaging cryptocurrency concepts."
      }, {
        role: "user",
        content: detailsPrompt
      }],
      temperature: 0.7,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "tokenInfoDetails",
          schema: this.tokenInfoDetailsJsonSchemaForAiClient,
          strict: true
        }
      },
      n: 1,
    });

    if (detailsResponse.choices[0].message.content === null) {
      throw new Error('Failed to generate token info details');
    }

    return JSON.parse(detailsResponse.choices[0].message.content);
  }

  private async generateTokenImage(tokenInfoDetails: TokenInfoDetails): Promise<string> {
    const imagePrompt = `
      Create a fun and memeable cryptocurrency logo for a coin with symbol "${tokenInfoDetails.symbol}" and name "${tokenInfoDetails.name}".
      The coin's theme is: ${tokenInfoDetails.description}.
      Style: Cartoon-like, vibrant colors, memorable, suitable for crypto community.
      Make it a circular coin design with no text.
    `;

    const imageResponse = await this.aiClient.images.generate({
      prompt: imagePrompt,
      model: "dall-e-2",
      n: 1,
      // quality: 'standard', // only for dall-e-3
      size: "512x512",
      response_format: "b64_json",
      style: "vivid",
    });

    if (imageResponse.data[0].b64_json === undefined) {
      throw new Error('Failed to generate token image');
    }

    return imageResponse.data[0].b64_json;
  }

  private async uploadToIpfs(imageBase64: string, tokenInfo: TokenInfoDetails): Promise<string> {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const fileName = `${tokenInfo.symbol}-${uuidv4()}.png`;
    const file = new File([imageBuffer], fileName, {type: 'image/png'});

    const pinataImageUploadResult = await this.pinata.upload.file(file);
    const imageHash = `ipfs://${pinataImageUploadResult.IpfsHash}`;

    const metadata = {
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      description: tokenInfo.description,
      image: imageHash,
    };
    const metadataFileName = `${tokenInfo.symbol}-${uuidv4()}.json`;

    const pinataMetadataUploadResult = await this.pinata.upload.json(metadata, {
      metadata: {
        name: metadataFileName,
      }
    });
    return `ipfs://${pinataMetadataUploadResult.IpfsHash}`;
  }
}
