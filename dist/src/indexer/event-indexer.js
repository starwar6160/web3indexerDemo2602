"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventIndexer = void 0;
exports.createEventIndexer = createEventIndexer;
const viem_1 = require("viem");
const simple_bank_1 = require("../abis/simple-bank");
const transaction_repository_1 = require("../database/transaction-repository");
const sync_status_repository_1 = require("../database/sync-status-repository");
const strict_schemas_1 = require("../database/strict-schemas");
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Event Indexer - Phase 3: Event parsing core logic
 *
 * Fetches logs from RPC, decodes events, validates with Zod, saves to DB
 *
 * SpaceX philosophy:
 * - getLogs error -> crash immediately
 * - decode error -> crash immediately
 * - validation error -> crash immediately
 * - DB constraint violation -> crash immediately
 */
class EventIndexer {
    constructor(rpcUrl, contractAddress) {
        this.processorName = 'simplebank_event_indexer';
        this.client = (0, viem_1.createPublicClient)({
            transport: (0, viem_1.http)(rpcUrl),
        });
        this.txRepo = new transaction_repository_1.TransactionRepository();
        this.syncRepo = new sync_status_repository_1.SyncStatusRepository();
        this.contractAddress = contractAddress;
    }
    /**
     * Index events from a block range
     * Fail-fast: any error throws immediately
     */
    async indexEvents(fromBlock, toBlock) {
        logger_1.default.info({
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
            contract: this.contractAddress,
        }, 'Indexing events');
        // 1. Fetch logs from RPC - fail fast on error
        const logs = await this.fetchLogs(fromBlock, toBlock);
        if (logs.length === 0) {
            logger_1.default.info('No events found in range');
            return 0;
        }
        // 2. Validate raw logs with Zod - fail fast on invalid data
        const validatedLogs = (0, strict_schemas_1.strictValidateLogs)(logs, 'event_indexer');
        // 3. Decode events - fail fast on decode error
        const decodedEvents = this.decodeEvents(validatedLogs);
        // 4. Transform to transactions
        const transactions = this.transformToTransactions(decodedEvents);
        // 5. Save to DB with idempotent upsert
        await this.saveTransactions(transactions);
        // 6. Update sync status
        const lastBlockHash = logs[logs.length - 1]?.blockHash;
        await this.syncRepo.updateProgress(this.processorName, toBlock, null, lastBlockHash ?? undefined);
        logger_1.default.info({
            count: transactions.length,
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
        }, 'Events indexed successfully');
        return transactions.length;
    }
    /**
     * Fetch logs from RPC
     * @throws Error if RPC fails (fail fast)
     */
    async fetchLogs(fromBlock, toBlock) {
        try {
            const logs = await this.client.getLogs({
                address: this.contractAddress,
                fromBlock,
                toBlock,
            });
            return logs;
        }
        catch (error) {
            logger_1.default.error({ error, fromBlock, toBlock }, 'RPC getLogs failed');
            throw new Error(`Failed to fetch logs: ${error}`);
        }
    }
    /**
     * Decode events using ABI
     * @throws Error if decode fails (fail fast)
     */
    decodeEvents(logs) {
        return logs.map((log) => {
            try {
                const decoded = (0, viem_1.decodeEventLog)({
                    abi: simple_bank_1.simpleBankAbi,
                    data: log.data,
                    topics: log.topics,
                });
                return {
                    eventName: decoded.eventName,
                    args: decoded.args,
                    blockNumber: log.blockNumber,
                    txHash: log.transactionHash,
                    logIndex: log.logIndex,
                };
            }
            catch (error) {
                logger_1.default.error({ error, log }, 'Event decode failed');
                throw new Error(`Failed to decode event: ${error}`);
            }
        });
    }
    /**
     * Transform decoded events to transaction records
     */
    transformToTransactions(events) {
        return events
            .filter((e) => e.eventName === 'Deposit') // Only index deposits for now
            .map((event) => ({
            tx_hash: event.txHash,
            block_number: event.blockNumber,
            from_address: String(event.args.from || '0x0'),
            to_address: this.contractAddress,
            value: String(event.args.amount || '0'),
            gas_price: null,
            gas_used: null,
            status: 1, // success
        }));
    }
    /**
     * Save transactions to DB
     * Uses idempotent upsert - duplicate (block_number, tx_hash) will update
     */
    async saveTransactions(transactions) {
        for (const tx of transactions) {
            try {
                await this.txRepo.saveTransaction(tx);
            }
            catch (error) {
                logger_1.default.error({ error, tx }, 'Failed to save transaction');
                throw new Error(`DB save failed: ${error}`);
            }
        }
    }
    /**
     * Get last processed block from sync status
     */
    async getLastProcessedBlock() {
        const status = await this.syncRepo.getStatus(this.processorName);
        return status?.last_processed_block ?? 0n;
    }
    /**
     * Run continuous indexing with polling
     */
    async startPolling(pollIntervalMs = 2000) {
        logger_1.default.info({ pollIntervalMs }, 'Starting event indexer polling');
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const lastBlock = await this.getLastProcessedBlock();
                const currentBlock = await this.client.getBlockNumber();
                if (lastBlock < currentBlock) {
                    const fromBlock = lastBlock + 1n;
                    await this.indexEvents(fromBlock, currentBlock);
                }
                else {
                    logger_1.default.debug('No new blocks to index');
                }
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
            catch (error) {
                logger_1.default.error({ error }, 'Polling error - crashing');
                throw error; // Fail fast - let global handler catch
            }
        }
    }
}
exports.EventIndexer = EventIndexer;
/**
 * Factory function to create indexer
 */
function createEventIndexer(rpcUrl = process.env.RPC_URL || 'http://localhost:8545', contractAddress) {
    return new EventIndexer(rpcUrl, contractAddress);
}
