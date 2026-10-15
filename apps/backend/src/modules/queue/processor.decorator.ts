import { SetMetadata } from '@nestjs/common';

export const BULLMQ_PROCESSOR_METADATA = 'bullmq:processor_queue_name';

/* Class decorator marking a class as a BullMQ queue processor */
export const Processor = (queueName: string): ClassDecorator => {
  return SetMetadata(BULLMQ_PROCESSOR_METADATA, queueName);
};
