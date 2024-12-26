import {Address, createPublicClient, createWalletClient, decodeEventLog, http, parseEther} from 'viem';
import {HATCH_HOG_ABI} from '../abis/hatchhog-abi';
import {privateKeyToAccount} from 'viem/accounts';
import {BOT_PRIVATE_KEY, CONFIG, HATCHHOG_CONTRACT_ADDRESS, RPC_URL, TREASURY_ADDRESS} from '../config';
import {randomBytes} from 'crypto';
import {fetchFromSubgraph} from "../utils/subgraph.ts";
import {logger} from "../utils/logger.ts";

export class HatchhogService {
  private readonly publicClient;
  private readonly walletClient;
  private readonly account;

  constructor() {
    this.publicClient = createPublicClient({
      chain: CONFIG.CONTRACT.CHAIN,
      transport: http(RPC_URL)
    });
    this.account = privateKeyToAccount(BOT_PRIVATE_KEY as `0x${string}`);
    this.walletClient = createWalletClient({
      chain: CONFIG.CONTRACT.CHAIN,
      transport: http(RPC_URL),
      account: this.account
    });
  }

  getSonicMarketUrlForToken(token: Address): string {
    return `https://www.sonic.market/hatch-hog/trade?inputCurrency=0x0000000000000000000000000000000000000000&outputCurrency=${token}&chain=146`
  }

  async hatch(
    name: string,
    symbol: string,
    creator: Address | null,
    tokenURI: string,
    salt?: `0x${string}` | undefined
  ): Promise<Address> {
    try {
      if (!creator) {
        creator = TREASURY_ADDRESS as `0x${string}`;
      }
      if (!salt) {
        salt = `0x${randomBytes(32).toString('hex')}` as `0x${string}`;
      }

      const hash = await this.walletClient.writeContract({
        account: this.account,
        chain: CONFIG.CONTRACT.CHAIN,
        address: HATCHHOG_CONTRACT_ADDRESS as `0x${string}`,
        abi: HATCH_HOG_ABI,
        functionName: 'hatch',
        args: [name, symbol, creator, salt, tokenURI],
        value: parseEther(CONFIG.CONTRACT.MINT_FEE.toString())
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({hash});
      if (receipt.status !== 'success') {
        throw new Error('Hatch transaction failed');
      }

      const hatchEvent = receipt.logs.map(log => {
        try {
          return decodeEventLog({
            abi: HATCH_HOG_ABI,
            data: log.data,
            topics: log.topics
          });
        } catch {
          return null;
        }
      }).find(event => event?.eventName === 'Hatch');

      if (!hatchEvent || hatchEvent.eventName !== 'Hatch') {
        throw new Error('Hatch event not found in transaction receipt');
      }

      return hatchEvent.args.token as Address;
    } catch (error: any) {
      logger.error('Error while hatching', {
        name,
        symbol,
        creator,
        tokenURI,
        error: error.stack
      });
      throw error;
    }
  }

  async migrateAll(): Promise<Address[]> {
    const migratedTokens: Address[] = [];
    try {
      const targets = await this.getMigrateTargets();
      for (const target of targets) {
        await this.migrate(target);
        migratedTokens.push(target);
      }
      return migratedTokens;
    } catch (error: any) {
      logger.error('Error while migrating', {
        error: error.stack
      });
      throw error;
    }
  }

  private async migrate(tokenAddress: Address): Promise<`0x${string}`> {
    try {
      const hash = await this.walletClient.writeContract({
        account: this.account,
        chain: CONFIG.CONTRACT.CHAIN,
        address: HATCHHOG_CONTRACT_ADDRESS as `0x${string}`,
        abi: HATCH_HOG_ABI,
        functionName: 'migrate',
        args: [tokenAddress]
      });
      await this.publicClient.waitForTransactionReceipt({hash});
      return hash;
    } catch (error: any) {
      logger.error('Error while migrating', {
        tokenAddress,
        error: error.stack
      });
      throw error;
    }
  }

  private async getMigrateTargets(): Promise<Address[]> {
    try {
      const migrateCandidates = await fetchFromSubgraph<{
        data: {
          hogTokens: {
            id: Address;
            deadline: bigint;
            priorMilestones: {
              unitAmount: bigint;
              unitFilledAmount: bigint;
            }[]
          }[]
        }
      }>(
        'getMigrateTargets',
        'query getMigrateTargets { hogTokens(where: { migrated: false }) { id deadline priorMilestones { unitAmount unitFilledAmount } } }',
        {},
      )
      return migrateCandidates.data.hogTokens.filter(hogToken => {
        if (BigInt(hogToken.deadline) < BigInt(Date.now() / 1000)) {
          return true;
        }
        return hogToken.priorMilestones.length == CONFIG.CONTRACT.PRIOR_MILESTONE_LENGTH
          && hogToken.priorMilestones.every(milestone =>
            BigInt(milestone.unitAmount) === BigInt(milestone.unitFilledAmount)
          );
      }).map(hogToken => hogToken.id);
    } catch (error: any) {
      logger.error('Error while fetching migrate targets', {
        error: error.stack
      });
      throw error;
    }
  }
}