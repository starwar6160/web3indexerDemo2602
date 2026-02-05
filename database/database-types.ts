import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface Database {
  blocks: BlockTable;
  sync_checkpoints: CheckpointTable;
  app_locks: AppLockTable;
}

export interface BlockTable {
  number: ColumnType<bigint, string | number, bigint>;
  hash: string;
  timestamp: ColumnType<bigint, string | number, bigint>;
  parent_hash: string;
  chain_id: ColumnType<bigint, string | number, bigint>;
  created_at: ColumnType<Date, string, Date>;
  updated_at: ColumnType<Date, string, Date>;
}

export interface CheckpointTable {
  id: Generated<number>;
  name: string;
  block_number: ColumnType<bigint, string | number, bigint>;
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