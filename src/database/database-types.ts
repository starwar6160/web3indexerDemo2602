import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface Database {
  blocks: BlockTable;
  transactions: TransactionTable; // Phase 3: Event data storage
  transaction_logs: TransactionLogTable;
  sync_checkpoints: CheckpointTable;
  sync_status: SyncStatusTable; // Phase 3: Detailed progress tracking
  app_locks: AppLockTable;
}

export interface BlockTable {
  number: ColumnType<bigint, bigint, bigint>;  // C++风格：全链路bigint
  hash: string;
  timestamp: ColumnType<bigint, bigint, bigint>;  // C++风格：全链路bigint
  parent_hash: string;
  chain_id: ColumnType<bigint, bigint, bigint>;  // C++风格：全链路bigint
  created_at: ColumnType<Date, string, Date>;
  updated_at: ColumnType<Date, string, Date>;
}

export interface CheckpointTable {
  id: Generated<number>;
  name: string;
  block_number: ColumnType<bigint, bigint, bigint>;  // C++风格：全链路bigint
  block_hash: string;
  synced_at: ColumnType<Date, string, Date>;
  metadata: ColumnType<Record<string, any> | null, string | null, Record<string, any> | null>;
  created_at: ColumnType<Date, string, Date>;
  updated_at: ColumnType<Date, string, Date>;
}

export type Block = Selectable<BlockTable>;
export type NewBlock = Insertable<BlockTable>;
export type BlockUpdate = Updateable<BlockTable>;

export type Checkpoint = Selectable<CheckpointTable>;
export type NewCheckpoint = Insertable<CheckpointTable>;
export type CheckpointUpdate = Updateable<CheckpointTable>;

// Phase 3: Transaction table for decoded event data
export interface TransactionTable {
  id: Generated<number>;
  tx_hash: string;
  block_number: ColumnType<bigint, bigint, bigint>;
  from_address: string;
  to_address: string | null;
  value: ColumnType<string | null, string | null, string | null>; // DECIMAL(78,18) as string
  gas_price: ColumnType<string | null, string | null, string | null>;
  gas_used: ColumnType<bigint | null, bigint | null, bigint | null>;
  status: ColumnType<number | null, number | null, number | null>;
  created_at: ColumnType<Date, string | undefined, Date>; // Optional with default
}

export type Transaction = Selectable<TransactionTable>;
export type NewTransaction = Insertable<TransactionTable>;
export type TransactionUpdate = Updateable<TransactionTable>;

export interface TransactionLogTable {
  id: Generated<number>;
  log_index: number;
  transaction_hash: string;
  block_number: ColumnType<string, string, string>; // NUMERIC(78,0) returned as string
  address: string;
  topics: string[];
  data: string;
  created_at: ColumnType<Date, string | undefined, Date>;
}

export type TransactionLog = Selectable<TransactionLogTable>;
export type NewTransactionLog = Insertable<TransactionLogTable>;
export type TransactionLogUpdate = Updateable<TransactionLogTable>;

// Phase 3: Sync status table for detailed progress tracking
export interface SyncStatusTable {
  id: Generated<number>;
  processor_name: string;
  last_processed_block: ColumnType<bigint, bigint, bigint>;
  last_processed_hash: string | null;
  target_block: ColumnType<bigint | null, bigint | null, bigint | null>;
  synced_percent: ColumnType<string | null, string | null, string | null>; // DECIMAL(5,2)
  status: string; // active, paused, error, complete
  error_message: string | null;
  updated_at: ColumnType<Date, string | undefined, string | undefined>; // String for insert/update
}

export type SyncStatus = Selectable<SyncStatusTable>;
export type NewSyncStatus = Insertable<SyncStatusTable>;
export type SyncStatusUpdate = Updateable<SyncStatusTable>;

export interface AppLockTable {
  name: Generated<string>;
  instance_id: string;
  expires_at: ColumnType<Date, string, Date>;
  created_at: ColumnType<Date, string, Date>;
  updated_at: ColumnType<Date, string, Date>;
}

export type AppLock = Selectable<AppLockTable>;
export type NewAppLock = Insertable<AppLockTable>;
export type AppLockUpdate = Updateable<AppLockTable>;