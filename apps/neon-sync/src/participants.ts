import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { Change, Participant } from './types.ts';

const PROJECTED_ATTRIBUTES = [
  'id',
  'neonId',
  'first',
  'last',
  'email',
  'unsubscribe',
  'vajrayana',
  'programs',
  'emails',
];

export type ApplyResult = 'applied' | 'conflict';

export class ParticipantTable {
  private readonly db: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, region: string) {
    this.tableName = tableName;
    this.db = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async scanAll(): Promise<Participant[]> {
    // Several of these (first, last) are DynamoDB reserved words.
    const names = Object.fromEntries(PROJECTED_ATTRIBUTES.map((a, i) => [`#a${i}`, a]));
    const participants: Participant[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.db.send(
        new ScanCommand({
          TableName: this.tableName,
          ProjectionExpression: Object.keys(names).join(', '),
          ExpressionAttributeNames: names,
          ExclusiveStartKey,
        }),
      );
      participants.push(...((page.Items ?? []) as Participant[]));
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return participants;
  }

  /**
   * Applies one change. Every write is conditioned on the state it was planned
   * against, so a record that changed underneath the run reports 'conflict'
   * instead of being overwritten.
   */
  async apply(change: Change): Promise<ApplyResult> {
    try {
      await this.write(change);
      return 'applied';
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return 'conflict';
      throw err;
    }
  }

  private async write(change: Change): Promise<void> {
    switch (change.kind) {
      case 'create':
        await this.db.send(
          new PutCommand({
            TableName: this.tableName,
            Item: change.item,
            ConditionExpression: 'attribute_not_exists(id)',
          }),
        );
        return;

      case 'setVajrayana':
        await this.update(change.participantId, {
          UpdateExpression: 'SET vajrayana = :value',
          ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(vajrayana)',
          ExpressionAttributeValues: { ':value': change.value },
        });
        return;

      case 'setProgramFlag':
        if (change.programExists) {
          await this.update(change.participantId, {
            UpdateExpression: 'SET programs.#program.#flag = :true',
            ConditionExpression: 'attribute_exists(programs.#program)',
            ExpressionAttributeNames: { '#program': change.program, '#flag': change.flag },
            ExpressionAttributeValues: { ':true': true },
          });
        } else {
          await this.update(change.participantId, {
            UpdateExpression: 'SET programs.#program = :state',
            ConditionExpression: 'attribute_exists(programs) AND attribute_not_exists(programs.#program)',
            ExpressionAttributeNames: { '#program': change.program },
            ExpressionAttributeValues: { ':state': { [change.flag]: true } },
          });
        }
        return;

      case 'updateEmail': {
        // REMOVE individual keys rather than rewriting the whole map so concurrent
        // sends recorded by other services aren't lost.
        const keyNames = Object.fromEntries(change.clearEmailKeys.map((k, i) => [`#k${i}`, k]));
        const remove = Object.keys(keyNames).map((n) => `emails.${n}`);
        await this.update(change.participantId, {
          UpdateExpression: `SET email = :email${remove.length ? ` REMOVE ${remove.join(', ')}` : ''}`,
          ConditionExpression: change.previousEmail
            ? 'email = :previous'
            : 'attribute_exists(id) AND (attribute_not_exists(email) OR email = :previous)',
          ExpressionAttributeNames: remove.length ? keyNames : undefined,
          ExpressionAttributeValues: { ':email': change.email, ':previous': change.previousEmail },
        });
        return;
      }
    }
  }

  private async update(
    id: string,
    input: Omit<UpdateCommandInput, 'TableName' | 'Key'>,
  ): Promise<void> {
    await this.db.send(new UpdateCommand({ TableName: this.tableName, Key: { id }, ...input }));
  }
}
