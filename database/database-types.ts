import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

export interface Database {
  blocks: BlockTable;
}

export interface BlockTable {
  number: ColumnType<bigint, never, bigint>;
  hash: string;
  timestamp: ColumnType<number, never, number>;
  parent_hash: string;
  created_at: ColumnType<Date, string | undefined, Date>;
  updated_at: ColumnType<Date, string | undefined, Date>;
}

export type Block = Selectable<BlockTable>;
export type NewBlock = Insertable<BlockTable>;
export type BlockUpdate = Updateable<BlockTable>;