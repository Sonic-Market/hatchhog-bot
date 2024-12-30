import OpenAI from 'openai';
import {logger} from '../utils/logger';
import {OPENAI_API_KEY, PINATA_GATEWAY, PINATA_JWT} from '../config';
import {DescriptionAndContext, HatchhogTokenInfo} from "../types.ts";
import {PinataSDK} from 'pinata-web3';
import {v4 as uuidv4} from 'uuid';

type TokenInfoDetails = {
  name: string;
  symbol: string;
  description: string;
  imageDescription: string;
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
      imageDescription: {type: "string"}
    },
    additionalProperties: false,
    required: ["name", "symbol", "description", "imageDescription"]
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

  public async generateTokenInfo(descriptionAndContext: DescriptionAndContext): Promise<HatchhogTokenInfo> {
    try {
      const tokenReceiver = this.extractWalletAddress(descriptionAndContext.description);
      const generatedTokenInfoDetails = await this.generateTokenInfoDetails(descriptionAndContext);
      const imageBase64 = await this.generateTokenImage(generatedTokenInfoDetails);
      const metaUri = await this.uploadToIpfs(imageBase64, generatedTokenInfoDetails);

      return {
        name: generatedTokenInfoDetails.name,
        symbol: generatedTokenInfoDetails.symbol,
        description: generatedTokenInfoDetails.description,
        metaUri,
        tokenReceiver
      };
    } catch (error: any) {
      logger.error('Error generating token info', {
        description: descriptionAndContext.description,
        context: descriptionAndContext.context,
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

  private async generateTokenInfoDetails(descriptionAndContext: DescriptionAndContext): Promise<TokenInfoDetails> {
    const {description, context, imageUrls} = descriptionAndContext;
    const contextPrompt = context.length > 0 ? `
      Additional context(description is reply tweet of context):
      "${context}"
    ` : '';
    const imagePrompt = imageUrls.length > 0 ? `
      FYI; description and context include the attached image(s).
      each image is either a photo or a preview image of a video.
    ` : '';
    const detailsPrompt = `
      Create a meme cryptocurrency based on the following description:
      "${description}"

      ${contextPrompt}

      ${imagePrompt}

      Generate a creative name, symbol, description and imageDescription that match the theme.
      NOTE: 'imageDescription' should be suitable for a logo design. It will be used as a prompt to generate the logo. So any blocked words or inappropriate content should be avoided. specifically, avoid using the name of real people, brands, or any other copyrighted content.

      Format the response as a JSON object with:
      - name (string)
      - symbol (1~4 letters)
      - description (string)
      - imageDescription (string)
    `;

    const detailsResponse = await this.aiClient.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "system",
        content: "You are a creative meme coin generator that creates fun and engaging cryptocurrency concepts."
      }, {
        role: "user",
        content: [
          {
            type: "text",
            text: detailsPrompt
          },
          ...imageUrls.map(url => ({
            type: "image_url",
            image_url: {
              url,
            }
          } as const))
        ]
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
      The logo's description is: ${tokenInfoDetails.imageDescription}.
      Make it a circular logo.
      NOTE: No text should be included in the logo.
      Style: Cartoon-like, vibrant colors, memorable, suitable for crypto community.
    `;

    const imageResponse = await this.aiClient.images.generate({
      prompt: imagePrompt,
      model: "dall-e-3",
      n: 1,
      quality: 'hd', // only for dall-e-3
      size: "1024x1024", // only for dall-e-3
      response_format: "b64_json",
      style: "vivid", // only for dall-e-3
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
