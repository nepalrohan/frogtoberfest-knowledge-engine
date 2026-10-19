import { InitialSchema1792401700765 } from './1792401700765-InitialSchema';
import { AddConversations1792408690173 } from './1792408690173-AddConversations';
import { AddAnswerCache1792500000000 } from './1792500000000-AddAnswerCache';

/* Ordered list of schema migrations; append new migration classes here */
export const MIGRATIONS = [
  InitialSchema1792401700765,
  AddConversations1792408690173,
  AddAnswerCache1792500000000,
];
