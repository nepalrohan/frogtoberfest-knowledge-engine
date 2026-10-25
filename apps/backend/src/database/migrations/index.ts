import { InitialSchema1792401700765 } from './1792401700765-InitialSchema';
import { AddConversations1792408690173 } from './1792408690173-AddConversations';
import { AddAnswerCache1792500000000 } from './1792500000000-AddAnswerCache';
import { AddConnectorsEntities1792521063577 } from './1792521063577-AddConnectorsEntities';
import { AddSyncTablesAndOutboxDeadLetter1792945540654 } from './1792945540654-AddSyncTablesAndOutboxDeadLetter';

/* Ordered list of schema migrations; append new migration classes here */
export const MIGRATIONS = [
  InitialSchema1792401700765,
  AddConversations1792408690173,
  AddAnswerCache1792500000000,
  AddConnectorsEntities1792521063577,
  AddSyncTablesAndOutboxDeadLetter1792945540654,
];
